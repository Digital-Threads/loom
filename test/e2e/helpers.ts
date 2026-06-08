import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CmdRunner, CmdResult, InstallDeps } from "../../src/core/install/types.js";

// Временный корень + подмена HOME/XDG на него. Возвращает cleanup.
export function withTempHome(): {
  root: string;
  env: Record<string, string>;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "loom-e2e-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const env = {
    HOME: home,
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_CONFIG_HOME: join(home, ".config"),
  };
  return { root, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Recording-раннер: пишет каждый вызов, НИЧЕГО не исполняет. Можно задать
// детерминированные ответы по имени команды (мок npm pack / git clone и т.п.).
export function recordingRun(
  responses: Partial<Record<string, CmdResult>> = {},
): { run: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return responses[cmd] ?? { ok: true, stdout: "", stderr: "" };
  };
  return { run, calls };
}

// Собрать InstallDeps поверх временного корня и recording-раннера.
// dataDir строго внутри root — никаких записей в реальный HOME.
export function e2eDeps(root: string, run: CmdRunner): InstallDeps {
  return { dataDir: join(root, "data"), run };
}

// Записать на диск фейковый локальный плагин с валидным манифестом Loom.
// Форма манифеста и раскладка файлов скопированы из test/core/install/install.test.ts
// (makeLocalPlugin/baseManifest): manifest = plugin.json, адаптер = src/adapter.js.
export function writeFakePlugin(dir: string, name = "demo"): string {
  mkdirSync(join(dir, "src"), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    type: "loom-plugin",
    name,
    title: "Demo",
    version: "1.0.0",
    apiVersion: "^1.0",
    entry: "./src/adapter.js",
    provides: { tabs: [{ id: name, title: "Demo" }] },
  };
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest), "utf8");
  writeFileSync(join(dir, "src", "adapter.js"), "export const plugin = {};", "utf8");
  return dir;
}
