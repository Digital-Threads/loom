import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlugin } from "../../../src/core/install/install.js";
import { readInstalled } from "../../../src/core/install/registry-file.js";
import type { CmdRunner, InstallDeps } from "../../../src/core/install/types.js";

// ── temp-фикстуры: чистим после каждого теста ────────────────────────────────
const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// makeDeps(results?) — раннер пишет calls и возвращает results[key] ?? {ok:true}.
// Ключ = "cmd arg1 arg2".join(" "). dataDir — изолированная temp-директория.
function makeDeps(
  results: Record<string, { ok: boolean; stderr?: string }> = {},
): { deps: InstallDeps; calls: string[][] } {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(" ");
    const r = results[key];
    return { ok: r?.ok ?? true, stdout: "", stderr: r?.stderr ?? "" };
  };
  const deps: InstallDeps = { dataDir: tmp("loom-rb-"), run };
  return { deps, calls };
}

// Валидный манифест Loom-плагина + опциональные поля (name = "demo").
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

// Создаёт каталог локального плагина с plugin.json и фейковым адаптером.
function makeLocalPlugin(manifest: Record<string, unknown>): string {
  const dir = tmp("loom-src-");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest), "utf8");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "adapter.js"), "export const plugin = {};", "utf8");
  return dir;
}

describe("installPlugin — откат при сбое install-рецепта", () => {
  it("2-й шаг install падает → реестр чист, ok:false, понятная ошибка", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [
            { cmd: "npm", args: ["install", "-g", "x"] },
            { cmd: "claude", args: ["plugin", "install", "y@y"] },
          ],
          detect: { probe: { cmd: "which", args: ["x"] } },
          remove: [],
        },
      }),
    );
    const { deps, calls } = makeDeps({
      "claude plugin install y@y": { ok: false, stderr: "install boom" },
    });
    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/install boom/);
    expect(readInstalled(deps).plugins["demo"]).toBeUndefined();
    expect(calls).toContainEqual(["npm", "install", "-g", "x"]);
  });

  it("optional-шаг падает → install НЕ откатывается, ok:true + warning", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [
            { cmd: "npm", args: ["install", "-g", "x"] },
            { cmd: "cargo", args: ["install", "z"], optional: true },
          ],
          detect: { probe: { cmd: "which", args: ["x"] } },
          remove: [],
        },
      }),
    );
    const { deps } = makeDeps({ "cargo install z": { ok: false, stderr: "no crate" } });
    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" });
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/no crate/);
    expect(readInstalled(deps).plugins["demo"]).toBeDefined();
  });

  it("успешный рецепт → реестр содержит запись", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [{ cmd: "npm", args: ["install", "-g", "x"] }],
          detect: { probe: { cmd: "which", args: ["x"] } },
          remove: [],
        },
      }),
    );
    const { deps } = makeDeps();
    expect(
      installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" }).ok,
    ).toBe(true);
    expect(readInstalled(deps).plugins["demo"]).toBeDefined();
  });
});
