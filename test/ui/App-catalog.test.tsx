import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";

// Изолируем источник данных: на этой машине реальные плагины читают живые данные
// (aimux ~/.aimux, token-pilot, task-journal), поэтому workspace никогда не пуст.
// Мокаем loader → пустой workspace, чтобы детерминированно проверить пустой старт
// (empty → активная вкладка Каталог) на любой машине. CatalogPanel рендерится с
// дефолтными deps и сам определяет статусы (defensive, в худшем случае not-installed).
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

import { App } from "../../src/ui/App.js";

const flush = async () => {
  // Ink коммитит кадр на таймере, не на микрозадаче — ждём макротакт.
  await new Promise((r) => setTimeout(r, 250));
};

describe("App: вкладка Каталог", () => {
  it("в TABS есть «Каталог» и «Config»", async () => {
    const { lastFrame, unmount } = render(<App />);
    await Promise.resolve(); await Promise.resolve();
    // Таб-бар при 100 колонках (ширина ink-testing) переносит длинные кириллические
    // подписи: «Каталог» рвётся на «Катал»/«ог» после добавления вкладки «Config»
    // (LP5). Проверяем по неразрывному фрагменту подписи + наличие новой вкладки.
    expect(lastFrame()!).toContain("Катал");
    expect(lastFrame()!).toContain("Config");
    unmount(); // снимаем App, чтобы фоновый detect не мешал следующему тесту
  });
  it("пустой старт → активна вкладка Каталог (виден список плагинов)", async () => {
    const { lastFrame, unmount } = render(<App />);
    await flush();
    expect(lastFrame()!).toContain("Token Pilot");
    unmount();
  });
});
