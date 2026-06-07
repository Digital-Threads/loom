import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlugin } from "../../../src/core/install/install.js";
import { requiredToolsForRecipe, preflightRecipe } from "../../../src/core/install/preflight.js";
import { readInstalled } from "../../../src/core/install/registry-file.js";
import type { CmdRunner, InstallDeps } from "../../../src/core/install/types.js";

// ── self-contained хелперы (форма из install.test.ts) ────────────────────────
const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "loom-plugin",
    name: "demo",
    title: "Demo",
    version: "1.0.0",
    apiVersion: "^1.0",
    entry: "./src/adapter.js",
    provides: { tabs: [{ id: "d", title: "Demo" }] },
    ...overrides,
  };
}

function makeLocalPlugin(manifest: Record<string, unknown>): string {
  const dir = tmp("loom-src-");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest), "utf8");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "adapter.js"), "export const plugin = {};", "utf8");
  return dir;
}

function makeDeps(): { deps: InstallDeps; calls: string[][] } {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { ok: true, stdout: "", stderr: "" };
  };
  const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
  return { deps, calls };
}

function allowCheck(present: string[]) {
  return (names: string[]) => {
    const tools = names.map((name) => ({ name, found: present.includes(name), hint: `нужен ${name}` }));
    const missing = tools.filter((t) => !t.found).map((t) => t.name);
    return { ok: missing.length === 0, tools, missing };
  };
}

describe("requiredToolsForRecipe", () => {
  it("явный requires имеет приоритет", () => {
    expect(requiredToolsForRecipe({ requires: ["cargo", "claude"],
      install: [{ cmd: "npm", args: ["i"] }], detect: { probe: { cmd: "which", args: ["x"] } }, remove: [] }))
      .toEqual(["cargo", "claude"]);
  });
  it("без requires выводит из step.cmd", () => {
    const r = requiredToolsForRecipe({ install: [
      { cmd: "cargo", args: ["install", "task-journal-cli"] }, { cmd: "claude", args: ["plugin", "install", "x@x"] }],
      detect: { probe: { cmd: "claude", args: ["plugin", "list"] } }, remove: [] });
    expect(r).toEqual(expect.arrayContaining(["cargo", "claude"]));
    expect(r).not.toContain("which");
  });
  it("npm-шаг тянет node и npm", () => {
    const r = requiredToolsForRecipe({ install: [{ cmd: "npm", args: ["install", "-g", "x"] }],
      detect: { probe: { cmd: "npm", args: ["ls"] } }, remove: [] });
    expect(r).toEqual(expect.arrayContaining(["node", "npm"]));
  });
});

describe("preflightRecipe", () => {
  it("инструмент отсутствует → ok:false, missing + hint", () => {
    const r = preflightRecipe({ install: [{ cmd: "cargo", args: ["install", "x"] }],
      detect: { probe: { cmd: "which", args: ["x"] } }, remove: [] }, { check: allowCheck(["node", "npm", "claude"]) });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("cargo");
    expect(r.hint).toMatch(/cargo|Rust/i);
  });
  it("все на месте → ok:true, missing:[]", () => {
    const r = preflightRecipe({ install: [{ cmd: "npm", args: ["i", "-g", "x"] }],
      detect: { probe: { cmd: "which", args: ["x"] } }, remove: [] }, { check: allowCheck(["node", "npm"]) });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe("installPlugin — preflight интеграция", () => {
  it("нет cargo → install НЕ зовёт рецепт, missing+hint, реестр чист", () => {
    const src = makeLocalPlugin(baseManifest({ install: {
      install: [{ cmd: "cargo", args: ["install", "task-journal-cli"] }, { cmd: "claude", args: ["plugin", "install", "x@x"] }],
      detect: { probe: { cmd: "which", args: ["x"] } }, remove: [] } }));
    const { deps, calls } = makeDeps();
    const res = installPlugin({ type: "local", path: src }, deps, () => true,
      { scope: "user", preflightCheck: allowCheck(["node", "npm", "claude"]) });
    expect(res.ok).toBe(false);
    expect(res.missing).toContain("cargo");
    expect(res.error).toMatch(/cargo|Rust|инструмент/i);
    expect(calls.some((c) => c[0] === "cargo")).toBe(false);
    expect(calls.some((c) => c[0] === "claude")).toBe(false);
    expect(readInstalled(deps).plugins["demo"]).toBeUndefined();
  });
});
