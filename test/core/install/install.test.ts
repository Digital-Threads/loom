import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchToStaging,
  installPlugin,
  planInstall,
  removePlugin,
} from "../../../src/core/install/install.js";
import { readInstalled } from "../../../src/core/install/registry-file.js";
import type { CmdRunner, InstallDeps, InstalledRegistry } from "../../../src/core/install/types.js";

// ── фейк-раннер: пишет вызовы, ничего не делает ──────────────────────────────
function fakeRun(): { run: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { ok: true, stdout: "", stderr: "" };
  };
  return { run, calls };
}

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Валидный манифест Loom-плагина + опциональные поля.
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

function makeDeps(): { deps: InstallDeps; calls: string[][] } {
  const { run, calls } = fakeRun();
  const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
  return { deps, calls };
}

describe("installPlugin — local", () => {
  it("happy path: копирует файлы и пишет реестр", () => {
    const src = makeLocalPlugin(baseManifest({ permissions: ["read:~/.x"] }));
    const { deps } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    expect(res.plan?.permissions).toEqual(["read:~/.x"]);

    const installed = join(deps.dataDir, "plugins", "demo", "1.0.0");
    expect(existsSync(join(installed, "plugin.json"))).toBe(true);
    expect(existsSync(join(installed, "src", "adapter.js"))).toBe(true);

    const reg = readInstalled(deps);
    expect(reg.plugins.demo.enabled).toBe(true);
    expect(reg.plugins.demo.version).toBe("1.0.0");
    expect(reg.plugins.demo.installPath).toBe(installed);
  });

  it("claudePlugin → вызывает marketplace add + install", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "./" } }),
    );
    const { deps, calls } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["claude", "plugin", "marketplace", "add", "./"]);
    expect(calls).toContainEqual([
      "claude",
      "plugin",
      "install",
      "x@x",
      "--scope",
      "user",
    ]);
  });

  it("onConfirm=false → ничего не копирует и не пишет реестр", () => {
    const src = makeLocalPlugin(baseManifest());
    const { deps } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps, () => false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("отменено");

    expect(existsSync(join(deps.dataDir, "plugins", "demo"))).toBe(false);
    expect(existsSync(join(deps.dataDir, "plugins.json"))).toBe(false);
  });

  it("невалидный манифест → ok:false с error", () => {
    const src = makeLocalPlugin(baseManifest({ type: "cc-plugin" }));
    const { deps } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/type/);
  });

  it("нет plugin.json в источнике → ok:false", () => {
    const empty = tmp("loom-empty-");
    const { deps } = makeDeps();
    const res = installPlugin({ type: "local", path: empty }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/plugin\.json/);
  });
});

describe("planInstall", () => {
  it("прокидывает permissions из манифеста", () => {
    const src = makeLocalPlugin(baseManifest({ permissions: ["read:~/.x", "exec:y"] }));
    const { deps } = makeDeps();
    const res = planInstall({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    expect(res.plan?.permissions).toEqual(["read:~/.x", "exec:y"]);
    expect(res.plan?.installDir).toBe(join(deps.dataDir, "plugins", "demo", "1.0.0"));
  });
});

describe("removePlugin", () => {
  it("убирает installDir и запись из реестра", () => {
    const src = makeLocalPlugin(baseManifest());
    const { deps } = makeDeps();
    installPlugin({ type: "local", path: src }, deps);

    const installed = join(deps.dataDir, "plugins", "demo", "1.0.0");
    expect(existsSync(installed)).toBe(true);

    const res = removePlugin("demo", deps);
    expect(res.ok).toBe(true);
    expect(existsSync(installed)).toBe(false);
    expect(readInstalled(deps).plugins.demo).toBeUndefined();
  });

  it("claudePlugin → вызывает claude plugin uninstall", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "./" } }),
    );
    const { deps, calls } = makeDeps();
    installPlugin({ type: "local", path: src }, deps);
    calls.length = 0;

    removePlugin("demo", deps);
    expect(calls).toContainEqual(["claude", "plugin", "uninstall", "x@x"]);
  });

  it("не установлен → ok:false", () => {
    const { deps } = makeDeps();
    expect(removePlugin("nope", deps).ok).toBe(false);
  });
});

describe("fetchToStaging — npm/git (покрыто только мок-вызовом run)", () => {
  it("npm: зовёт npm pack + tar extract", () => {
    const { run, calls } = fakeRun();
    // tar в фейке не распакует — fetch вернёт ошибку, но вызовы зафиксированы.
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    fetchToStaging({ type: "npm", spec: "demo@1.0.0" }, deps);
    expect(calls[0][0]).toBe("npm");
    expect(calls[0].slice(0, 3)).toEqual(["npm", "pack", "demo@1.0.0"]);
    expect(calls.some((c) => c[0] === "tar")).toBe(true);
  });

  it("git: зовёт git clone --depth 1", () => {
    const { run, calls } = fakeRun();
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    const res = fetchToStaging({ type: "git", url: "https://example/repo.git" }, deps);
    expect(res.ok).toBe(true);
    expect(calls[0].slice(0, 4)).toEqual(["git", "clone", "--depth", "1"]);
    expect(calls[0]).toContain("https://example/repo.git");
  });
});

// Тип-санити: реестр имеет ожидаемую форму.
describe("registry-file", () => {
  it("readInstalled на пустом dataDir → пустой реестр", () => {
    const { deps } = makeDeps();
    const reg: InstalledRegistry = readInstalled(deps);
    expect(reg.schemaVersion).toBe(1);
    expect(reg.plugins).toEqual({});
  });
});
