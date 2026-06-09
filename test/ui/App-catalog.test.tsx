import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";

// Изолируем источник данных: на этой машине реальные плагины читают живые данные
// (aimux ~/.aimux, token-pilot, task-journal), поэтому workspace никогда не пуст.
// Мокаем loader → пустой workspace, чтобы детерминированно проверить пустой старт
// (empty → активная вкладка Каталог) на любой машине.
vi.mock("../../src/core/data/loader.js", () => {
  const empty = {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
  };
  return {
    loadWorkspaceData: () => Promise.resolve(empty),
    isWorkspaceEmpty: () => true,
  };
});

// CatalogPanel в useEffect зовёт detectLatest(item, deps) по дефолтным deps, чей
// run = execFileSync (СИНХРОННЫЙ спавн npm/claude/which, timeout 5000мс на вызов).
// В юнит-тесте это: (а) лишний реальный I/O, (б) под параллельной нагрузкой сьюта
// синхронные спавны затыкают event loop → таймер ожидания голодает → тест ловит
// 5-сек таймаут vitest (это и был флейк ~1/6). Мокаем runner → мгновенный no-op
// run, ноль спавнов. buildCatalog всё равно отдаёт элементы из loomRegistry
// («Token Pilot» рендерится синхронно, независимо от detect).
vi.mock("../../src/core/install/runner.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/core/install/runner.js")>();
  const instant = () => ({ ok: false, stdout: "", stderr: "" });
  return {
    ...actual,
    defaultRun: instant,
    defaultDeps: () => ({ dataDir: "/tmp/loom-catalog-test", run: instant }),
  };
});

import { App } from "../../src/ui/App.js";

// Ink коммитит кадры на таймере, а активная вкладка приезжает async
// (loadWorkspaceData → setActive(Каталог) → ре-рендер → коммит). Поэтому ждём
// УСЛОВИЕ, а не фиксированное время: поллим lastFrame() пока не появится нужный
// фрагмент, с запасом по таймауту. Это убирает зависимость от тайминга под нагрузкой.
async function waitForFrame(
  lastFrame: () => string | undefined,
  needle: string,
  timeoutMs = 4000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = lastFrame() ?? "";
  while (!frame.includes(needle) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    frame = lastFrame() ?? "";
  }
  return frame;
}

describe("App: вкладка Каталог", () => {
  it("в TABS есть «Каталог» и «Config»", async () => {
    const { lastFrame, unmount } = render(<App />);
    // Таб-бар при 100 колонках (ширина ink-testing) переносит длинные кириллические
    // подписи: «Каталог» рвётся на «Катал»/«ог» после добавления вкладки «Config» (LP5).
    // Проверяем по неразрывному фрагменту подписи + наличие новой вкладки.
    // Tab bar at 100 columns (ink-testing width) wraps long labels: "Catalog"
    // breaks into "Catal"/"og" once the "Config" tab is added (LP5). Match the
    // unbroken fragment + presence of the new tab.
    const frame = await waitForFrame(lastFrame, "Catal");
    expect(frame).toContain("Catal");
    expect(frame).toContain("Conf");
    unmount(); // снимаем App, чтобы фоновый detect не мешал следующему тесту
  });
  it("пустой старт → активна вкладка Каталог (виден список плагинов)", async () => {
    const { lastFrame, unmount } = render(<App />);
    const frame = await waitForFrame(lastFrame, "Token Pilot");
    expect(frame).toContain("Token Pilot");
    unmount();
  });
});
