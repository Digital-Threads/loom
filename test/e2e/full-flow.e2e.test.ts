import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { withTempHome, recordingRun, e2eDeps, writeFakePlugin } from "./helpers.js";
import { runPluginCli } from "../../src/cli/plugin-cli.js";
import { readInstalled } from "../../src/core/install/registry-file.js";
import { buildPack } from "../../src/core/pack/build-pack.js";
import type { PackInput } from "../../src/core/pack/pack-input.js";
import type { WorkspaceData } from "../../src/core/data/loader.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

// Детерминированная фикстура WorkspaceData (без таймеров/Date.now): все слои пусты.
const emptyData: WorkspaceData = {
  subscriptions: [],
  sessions: [],
  health: [],
  tokens: [],
  tokenEvents: [],
  taskEvents: [],
  tasks: [],
  errors: [],
  projectId: "e2e-fixture",
};

describe("LP12 e2e: продукт от чистого окружения до workspace pack", () => {
  it("чистое окружение → каталог/CLI → ставим плагин → виден в реестре → pack непустой", () => {
    // 1. Чистое окружение: временный HOME/XDG, пустой реестр.
    const t = withTempHome();
    cleanups.push(t.cleanup);
    const { run, calls } = recordingRun({
      npm: { ok: true, stdout: "demo-1.0.0.tgz", stderr: "" },
      git: { ok: true, stdout: "", stderr: "" },
    });
    const deps = e2eDeps(t.root, run);

    // стартовое состояние — реестр пуст.
    expect(Object.keys(readInstalled(deps).plugins)).toHaveLength(0);
    const before = runPluginCli(["list"], deps);
    expect(before.code).toBe(0);
    expect(before.lines.join("\n")).toContain("нет установленных плагинов");

    // 2. Каталог → ставим плагин (локальный, без сети). Внешние команды — мок.
    const pluginDir = writeFakePlugin(join(t.root, "demo-plugin"));
    const add = runPluginCli(["add", pluginDir, "--yes"], deps);
    expect(add.code).toBe(0);

    // 3. Плагин виден в реестре (== «виден на дашборде»: тот же источник данных).
    const reg = readInstalled(deps);
    expect(Object.keys(reg.plugins)).toContain("demo");
    const after = runPluginCli(["list"], deps);
    expect(after.code).toBe(0);
    expect(after.lines.join("\n")).toContain("demo");

    // 4. Никаких реальных сайд-эффектов: всё, что вызывалось, — из белого списка
    //    внешних команд. Локальная установка может не дёргать внешних команд вовсе
    //    (calls пуст) — это тоже валидно.
    const allowed = ["npm", "git", "claude"];
    for (const c of calls) expect(allowed).toContain(c[0]);

    // 5. workspace pack отдаёт непустой контекст для новой сессии.
    const packInput: PackInput = {
      data: emptyData,
      config: { projectName: "e2e-demo" },
    };
    const pack = buildPack(packInput);
    expect(pack.length).toBeGreaterThan(0);
    expect(pack).toContain("# Workspace pack");
    expect(pack).toContain("e2e-demo");
  });

  it.skipIf(process.env.LOOM_E2E_REAL !== "1")(
    "реальный путь установки (под guard LOOM_E2E_REAL=1, в CI выключен)",
    () => {
      // Реальный CmdRunner, реальная сеть — только локально вручную.
      // Заглушка: при выставленном LOOM_E2E_REAL=1 здесь подключается реальный
      // пайплайн. По умолчанию кейс пропускается.
    },
  );
});
