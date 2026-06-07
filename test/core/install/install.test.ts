import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchToStaging,
  installPlugin,
  isFlagShaped,
  isValidGitUrl,
  isValidMarketplaceSource,
  isValidNpmSpec,
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

  it("claudePlugin без install → синтез shim-рецепта (marketplace add + install --scope)", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "./" } }),
    );
    const { deps, calls } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" });
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["claude", "plugin", "marketplace", "add", "--", "./"]);
    expect(calls).toContainEqual([
      "claude",
      "plugin",
      "install",
      "--scope",
      "user",
      "--",
      "x@x",
    ]);
  });

  it("manifest.install → finalize гоняет рецепт install со scope", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [
            { cmd: "claude", args: ["plugin", "install", "--scope", "{scope}", "x@x"], scoped: true },
          ],
          detect: { probe: { cmd: "claude", args: ["plugin", "list"] } },
          remove: [{ cmd: "claude", args: ["plugin", "uninstall", "x@x"] }],
        },
      }),
    );
    const { deps, calls } = makeDeps();
    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "project" });
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["claude", "plugin", "install", "--scope", "project", "x@x"]);
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

  it("manifest.install с interactive-шагом → авто-часть встаёт, manual отдан, не падает", () => {
    const src = makeLocalPlugin(baseManifest({ install: {
      install: [{ cmd: "npm", args: ["install","-g","aimux"] },
                { cmd: "aimux", args: ["auth","login"], interactive: true }],
      detect: { probe: { cmd: "which", args: ["aimux"] } }, remove: [] } }));
    const { deps, calls } = makeDeps();
    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" });
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["npm","install","-g","aimux"]);
    expect(calls.some((c) => c[0] === "aimux")).toBe(false);
    expect(res.manual).toEqual([["aimux","auth","login"]]);
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
    expect(calls).toContainEqual(["claude", "plugin", "uninstall", "--", "x@x"]);
  });

  it("manifest.install → removePlugin гоняет рецепт remove", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [],
          detect: { probe: { cmd: "claude", args: ["plugin", "list"] } },
          remove: [{ cmd: "claude", args: ["plugin", "uninstall", "x@x"] }],
        },
      }),
    );
    const { deps, calls } = makeDeps();
    installPlugin({ type: "local", path: src }, deps);
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
    // npm pack печатает имя tgz на stdout → flow доходит до tar (фейк tar ничего не делает).
    const calls: string[][] = [];
    const run: CmdRunner = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "npm") return { ok: true, stdout: "demo-1.0.0.tgz\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    };
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    fetchToStaging({ type: "npm", spec: "demo@1.0.0" }, deps);
    expect(calls[0][0]).toBe("npm");
    expect(calls[0].slice(0, 2)).toEqual(["npm", "pack"]);
    // "--" end-of-options стоит прямо перед spec.
    expect(calls[0].slice(-2)).toEqual(["--", "demo@1.0.0"]);
    expect(calls.some((c) => c[0] === "tar")).toBe(true);
    // tar: флаги/опции, затем "--", затем файл (имя tgz последним аргументом).
    const tarCall = calls.find((c) => c[0] === "tar")!;
    expect(tarCall[tarCall.length - 2]).toBe("--");
    expect(tarCall[tarCall.length - 1]).toMatch(/demo-1\.0\.0\.tgz$/);
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

// ── Argument-injection hardening ─────────────────────────────────────────────
describe("валидаторы входа (argument injection)", () => {
  it("isFlagShaped: flag-shaped и пробел-в-начале → true; нормальное → false", () => {
    expect(isFlagShaped("-x")).toBe(true);
    expect(isFlagShaped("--upload-pack=y")).toBe(true);
    expect(isFlagShaped("  --evil")).toBe(true);
    expect(isFlagShaped("https://github.com/o/r.git")).toBe(false);
    expect(isFlagShaped("owner/repo")).toBe(false);
  });

  it("isValidGitUrl", () => {
    expect(isValidGitUrl("https://github.com/o/r.git")).toBe(true);
    expect(isValidGitUrl("git@github.com:o/r.git")).toBe(true);
    expect(isValidGitUrl("github:o/r")).toBe(true);
    expect(isValidGitUrl("-x")).toBe(false);
    expect(isValidGitUrl("--upload-pack=evil")).toBe(false);
    expect(isValidGitUrl(" https://x")).toBe(false);
  });

  it("isValidNpmSpec", () => {
    expect(isValidNpmSpec("@scope/pkg@1.2.3")).toBe(true);
    expect(isValidNpmSpec("demo@1.0.0")).toBe(true);
    expect(isValidNpmSpec("pkg")).toBe(true);
    expect(isValidNpmSpec("-x")).toBe(false);
    expect(isValidNpmSpec("--registry=evil")).toBe(false);
    expect(isValidNpmSpec(" demo")).toBe(false);
  });

  it("isValidMarketplaceSource", () => {
    expect(isValidMarketplaceSource("owner/repo")).toBe(true);
    expect(isValidMarketplaceSource("https://github.com/o/r")).toBe(true);
    expect(isValidMarketplaceSource("./")).toBe(true);
    expect(isValidMarketplaceSource("-evil")).toBe(false);
    expect(isValidMarketplaceSource(" owner/repo")).toBe(false);
  });
});

describe("fetchToStaging — отсекает злонамеренный вход без запуска команды", () => {
  it("git url flag-shaped → ok:false, run НЕ позван", () => {
    const { run, calls } = fakeRun();
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    const res = fetchToStaging({ type: "git", url: "--upload-pack=evil" }, deps);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("npm spec flag-shaped → ok:false, run НЕ позван", () => {
    const { run, calls } = fakeRun();
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    const res = fetchToStaging({ type: "npm", spec: "-x" }, deps);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("синтез claudePlugin-рецепта отсекает злонамеренный source", () => {
  it("cp.source='-evil' → marketplace add НЕ в calls, install Loom-части прошла", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "-evil" } }),
    );
    const { deps, calls } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    // marketplace add с flag-shaped источником НЕ должен попасть в вызовы (отфильтрован в plan).
    expect(calls.some((c) => c[2] === "marketplace" && c[3] === "add")).toBe(false);
    // install-шаг при этом синтезируется и выполняется.
    expect(calls).toContainEqual(["claude", "plugin", "install", "--scope", "user", "--", "x@x"]);
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
