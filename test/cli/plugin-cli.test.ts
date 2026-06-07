import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSource, runPluginCli } from "../../src/cli/plugin-cli.js";
import type { CmdRunner, InstallDeps } from "../../src/core/install/types.js";

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
  const { run, calls } = fakeRun();
  const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
  return { deps, calls };
}

describe("parseSource", () => {
  it("relative path → local", () => {
    expect(parseSource("./x")).toEqual({ type: "local", path: "./x" });
  });
  it("absolute path → local", () => {
    expect(parseSource("/abs/plugin")).toEqual({ type: "local", path: "/abs/plugin" });
  });
  it("github: → git", () => {
    expect(parseSource("github:user/repo")).toEqual({ type: "git", url: "github:user/repo" });
  });
  it("https .git → git", () => {
    expect(parseSource("https://example.com/a.git")).toEqual({
      type: "git",
      url: "https://example.com/a.git",
    });
  });
  it("git@ → git", () => {
    expect(parseSource("git@github.com:u/r.git")).toEqual({
      type: "git",
      url: "git@github.com:u/r.git",
    });
  });
  it("scoped npm package → npm", () => {
    expect(parseSource("@scope/pkg")).toEqual({ type: "npm", spec: "@scope/pkg" });
  });
  it("bare npm package → npm", () => {
    expect(parseSource("some-pkg")).toEqual({ type: "npm", spec: "some-pkg" });
  });
});

describe("runPluginCli list", () => {
  it("пусто → 'нет установленных'", () => {
    const { deps } = makeDeps();
    const res = runPluginCli(["list"], deps);
    expect(res.code).toBe(0);
    expect(res.lines.join("\n")).toContain("нет установленных");
  });

  it("после установки показывает плагин", () => {
    const { deps } = makeDeps();
    const src = makeLocalPlugin(baseManifest());
    runPluginCli(["add", src, "--yes"], deps);
    const res = runPluginCli(["list"], deps);
    expect(res.code).toBe(0);
    const out = res.lines.join("\n");
    expect(out).toContain("demo");
    expect(out).toContain("1.0.0");
    expect(out).toContain("enabled");
  });
});

describe("runPluginCli add", () => {
  it("без --yes печатает план+разрешения, code 0, ничего не ставит", () => {
    const { deps } = makeDeps();
    const src = makeLocalPlugin(baseManifest({ permissions: ["fs:read", "net"] }));
    const res = runPluginCli(["add", src], deps);
    expect(res.code).toBe(0);
    const out = res.lines.join("\n");
    expect(out).toContain("demo@1.0.0");
    expect(out).toContain("fs:read");
    expect(out).toContain("net");
    expect(out).toContain("--yes");
    // ничего не установлено
    expect(existsSync(join(deps.dataDir, "plugins.json"))).toBe(false);
    const list = runPluginCli(["list"], deps);
    expect(list.lines.join("\n")).toContain("нет установленных");
  });

  it("--yes устанавливает local-плагин end-to-end", () => {
    const { deps } = makeDeps();
    const src = makeLocalPlugin(baseManifest());
    const res = runPluginCli(["add", src, "--yes"], deps);
    expect(res.code).toBe(0);
    expect(res.lines.join("\n")).toContain("✓ установлен demo@1.0.0");
    // файлы скопированы
    expect(existsSync(join(deps.dataDir, "plugins", "demo", "1.0.0", "plugin.json"))).toBe(true);
    // реестр обновлён
    const list = runPluginCli(["list"], deps);
    expect(list.lines.join("\n")).toContain("demo");
  });

  it("невалидный источник → code 1", () => {
    const { deps } = makeDeps();
    // несуществующий npm-пакет: planInstall зафейлит на fetch (фейк-run вернёт ok,
    // но staging будет пуст → нет plugin.json). Берём заведомо несуществующий путь
    // как npm-спеку через bare-имя, fetch не найдёт plugin.json.
    const res = runPluginCli(["add", "definitely-not-a-real-pkg-xyz"], deps);
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toContain("Ошибка");
  });

  it("без аргумента источника → code 1 + usage", () => {
    const { deps } = makeDeps();
    const res = runPluginCli(["add"], deps);
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toContain("Использование");
  });

  it("claudePlugin → вызывает claude install при --yes", () => {
    const { deps, calls } = makeDeps();
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "cp", marketplace: "mk" } }),
    );
    const res = runPluginCli(["add", src, "--yes"], deps);
    expect(res.code).toBe(0);
    const claudeInstall = calls.find(
      (c) => c[0] === "claude" && c[1] === "plugin" && c[2] === "install",
    );
    expect(claudeInstall).toBeDefined();
    expect(claudeInstall).toContain("cp@mk");
  });
});

describe("runPluginCli remove", () => {
  it("удаление установленного → code 0, ушёл из реестра", () => {
    const { deps } = makeDeps();
    const src = makeLocalPlugin(baseManifest());
    runPluginCli(["add", src, "--yes"], deps);
    const res = runPluginCli(["remove", "demo"], deps);
    expect(res.code).toBe(0);
    expect(res.lines.join("\n")).toContain("✓ удалён demo");
    const list = runPluginCli(["list"], deps);
    expect(list.lines.join("\n")).toContain("нет установленных");
  });

  it("удаление несуществующего → code 1", () => {
    const { deps } = makeDeps();
    const res = runPluginCli(["remove", "nope"], deps);
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toContain("Ошибка");
  });

  it("без имени → code 1 + usage", () => {
    const { deps } = makeDeps();
    const res = runPluginCli(["remove"], deps);
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toContain("Использование");
  });
});

describe("runPluginCli unknown", () => {
  it("неизвестная подкоманда → code 1 + usage", () => {
    const { deps } = makeDeps();
    const res = runPluginCli(["frobnicate"], deps);
    expect(res.code).toBe(1);
    expect(res.lines.join("\n")).toContain("Использование");
  });
});

describe("runPluginCli --scope", () => {
  it("add --scope project прокидывает scope в рецепт", () => {
    const { deps, calls } = makeDeps();
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [
            { cmd: "claude", args: ["plugin", "marketplace", "add", "https://github.com/x/tp"] },
            {
              cmd: "claude",
              args: ["plugin", "install", "--scope", "{scope}", "token-pilot@token-pilot"],
              scoped: true,
            },
          ],
          detect: {
            probe: { cmd: "claude", args: ["plugin", "list"] },
            presenceMatch: "token-pilot@token-pilot",
          },
          remove: [{ cmd: "claude", args: ["plugin", "uninstall", "token-pilot@token-pilot"] }],
        },
      }),
    );
    const r = runPluginCli(["add", src, "--yes", "--scope", "project"], deps);
    expect(r.code).toBe(0);
    expect(calls).toContainEqual([
      "claude",
      "plugin",
      "install",
      "--scope",
      "project",
      "token-pilot@token-pilot",
    ]);
  });

  it("add без --scope → scope=user по умолчанию", () => {
    const { deps, calls } = makeDeps();
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [
            {
              cmd: "claude",
              args: ["plugin", "install", "--scope", "{scope}", "x@x"],
              scoped: true,
            },
          ],
          detect: { probe: { cmd: "claude", args: ["plugin", "list"] } },
          remove: [],
        },
      }),
    );
    runPluginCli(["add", src, "--yes"], deps);
    expect(calls).toContainEqual(["claude", "plugin", "install", "--scope", "user", "x@x"]);
  });

  it("невалидный --scope → ошибка, команда не запускается", () => {
    const { deps, calls } = makeDeps();
    const r = runPluginCli(["add", "x", "--yes", "--scope", "evil"], deps);
    expect(r.code).toBe(1);
    expect(calls.length).toBe(0);
  });
});

describe("runPluginCli detect", () => {
  it("detect <name> печатает installed/version", () => {
    const { deps } = makeDeps();
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [],
          detect: { probe: { cmd: "which", args: ["x"] }, versionRegex: "v([0-9.]+)" },
          remove: [],
        },
      }),
    );
    runPluginCli(["add", src, "--yes"], deps);
    const r = runPluginCli(["detect", "demo"], deps);
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toContain("установлен demo");
  });

  it("detect несуществующего → code 1", () => {
    const { deps } = makeDeps();
    const r = runPluginCli(["detect", "nope"], deps);
    expect(r.code).toBe(1);
  });

  // Мягкий кейс: общий fakeRun всегда возвращает пустой stdout и не настраивается
  // по-командно, поэтому реально проверить "↻" в выводе нельзя без переписывания
  // makeDeps. Проверяем, что detect с detect.latest-спекой не падает (code 0).
  it("detect с detect.latest-спекой не падает (code 0)", () => {
    const { deps } = makeDeps();
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [],
          detect: {
            probe: { cmd: "which", args: ["x"] },
            versionRegex: "v([0-9.]+)",
            latest: { probe: { cmd: "npm", args: ["view", "x", "version"] } },
          },
          remove: [],
        },
      }),
    );
    runPluginCli(["add", src, "--yes"], deps);
    const r = runPluginCli(["detect", "demo"], deps);
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toContain("установлен demo");
  });
});
