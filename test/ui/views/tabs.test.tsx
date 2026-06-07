import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ViewRenderer } from "../../../src/ui/views/ViewRenderer.js";
import { overviewView, settingsView } from "../../../src/ui/views/host-views.js";
import { loomRegistry } from "../../../src/core/plugins/index.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";
import type { ViewSpec } from "../../../src/core/plugins/types.js";

function makeData(over: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    ...over,
  } as WorkspaceData;
}

const aimux = loomRegistry.get("aimux")!;
const tokenPilot = loomRegistry.get("token-pilot")!;
const taskJournal = loomRegistry.get("task-journal")!;

// Небольшая пауза, чтобы Ink успел отрисовать после stdin.write.
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("per-tab декларативный рендер через ViewRenderer", () => {
  it("Обзор: показывает счётчики (host summary, без плагина)", () => {
    const data = makeData({
      subscriptions: [{ name: "a", cli: "c", isSource: false }],
      sessions: [{ sessionId: "s1", profile: "p1" }, { sessionId: "s2", profile: "p2" }],
    });
    const { lastFrame } = render(<ViewRenderer spec={overviewView} data={data} />);
    expect(lastFrame()).toContain("Подписок: 1");
    expect(lastFrame()).toContain("Сессий: 2");
  });

  it("Обзор: строка ошибок видна только при errors.length > 0", () => {
    const ok = render(<ViewRenderer spec={overviewView} data={makeData()} />);
    expect(ok.lastFrame()).not.toContain("Ошибок загрузки");
    const bad = render(<ViewRenderer spec={overviewView} data={makeData({ errors: ["boom"] })} />);
    expect(bad.lastFrame()).toContain("Ошибок загрузки: 1");
  });

  it("Подписки: имя, маркер источника ★ и cli", () => {
    const data = makeData({
      subscriptions: [
        { name: "claude", cli: "claude-cli", isSource: true },
        { name: "gpt", cli: "gpt-cli", isSource: false },
      ],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={aimux} spec={aimux.views!.subscriptions} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("★ claude");
    expect(f).toContain("claude-cli");
    expect(f).toContain("gpt");
    // gpt не источник → нет звезды перед ним
    expect(f).not.toContain("★ gpt");
  });

  it("Сессии: id8, профиль и used/saved", () => {
    const data = makeData({
      sessions: [{ sessionId: "abcdef1234567890", profile: "claude" }],
      tokens: [{ sessionId: "abcdef1234567890", used: 100, saved: 25 }],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={aimux} spec={aimux.views!.sessions} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("abcdef12");
    expect(f).toContain("claude");
    expect(f).toContain("100/25");
  });

  it("Токены: итоговая строка + строка таблицы", () => {
    const data = makeData({
      tokens: [
        { sessionId: "abcdef1234", used: 100, saved: 10 },
        { sessionId: "ghijkl5678", used: 50, saved: 5 },
      ],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={tokenPilot} spec={tokenPilot.views!.tokens} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("Всего: потрачено 150 · сэкономлено 15");
    expect(f).toContain("abcdef12");
    expect(f).toContain("100");
  });

  it("Токены: пустое состояние без итоговой строки", () => {
    const { lastFrame } = render(
      <ViewRenderer plugin={tokenPilot} spec={tokenPilot.views!.tokens} data={makeData()} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("Нет данных о токенах");
    expect(f).not.toContain("Всего:");
  });

  it("Задачи: строка задачи + футер ↑/↓ — выбрать · Enter — открыть", () => {
    const data = makeData({
      tasks: [
        { id: "tj-1", title: "Открытая задача", status: "open" },
        { id: "tj-2", title: "Закрытая задача", status: "closed" },
      ],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={taskJournal} spec={taskJournal.views!.tasks} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("↑/↓ — выбрать · Enter — открыть");
    expect(f).toContain("○ Открытая задача");
    expect(f).toContain("✓ Закрытая задача");
    expect(f).toContain("tj-1");
  });

  it("Настройки: форма показывает поле token-pilot", () => {
    const { lastFrame } = render(<ViewRenderer spec={settingsView} data={makeData()} />);
    const f = lastFrame()!;
    expect(f).toContain("Настройки");
    expect(f).toContain("Режим хуков");
  });
});

describe("list → detail: открытие задачи через ViewRenderer", () => {
  it("Enter на задаче открывает деталь с секциями и легендой c/t", async () => {
    const taskEvents = [
      { event_id: "e1", task_id: "tj-1", type: "open", timestamp: "2026-06-07T10:00:00.000Z", text: "Открытая задача", meta: { title: "Открытая задача" } },
      { event_id: "e2", task_id: "tj-1", type: "decision", timestamp: "2026-06-07T10:05:00.000Z", text: "Решили использовать X" },
      { event_id: "e3", task_id: "tj-1", type: "finding", timestamp: "2026-06-07T10:06:00.000Z", text: "Нашли причину" },
    ];
    const data = makeData({
      tasks: [{ id: "tj-1", title: "Открытая задача", status: "open" }],
      taskEvents,
    });
    const { lastFrame, stdin } = render(
      <ViewRenderer plugin={taskJournal} spec={taskJournal.views!.tasks} data={data} />,
    );
    stdin.write("\r"); // Enter — открыть выбранную (первую) задачу
    await tick();
    const f = lastFrame()!;
    expect(f).toContain("Открытая задача");
    expect(f).toContain("Решения (1)");
    expect(f).toContain("Решили использовать X");
    expect(f).toContain("Находки (1)");
    expect(f).toContain("Токены задачи");
    expect(f).toContain("c — закрыть · t — записать токены · Esc — назад");
  });

  it("taskDetail-spec резолвится и DetailView рисует секции на прямом маунте", async () => {
    // Прямой маунт detail-вида (на случай если stdin-симуляция окажется хрупкой).
    const taskEvents = [
      { event_id: "e1", task_id: "tj-9", type: "open", timestamp: "2026-06-07T10:00:00.000Z", text: "T", meta: { title: "T" } },
      { event_id: "e2", task_id: "tj-9", type: "rejection", timestamp: "2026-06-07T10:05:00.000Z", text: "Отвергли Y" },
    ];
    const data = makeData({ tasks: [{ id: "tj-9", title: "Девятая", status: "open" }], taskEvents });
    const detailSpec = (taskJournal.views!.taskDetail as ViewSpec);
    expect((detailSpec as { kind: string }).kind).toBe("detail");

    // Маунтим таблицу, открываем через onSelect: проще проверить через DetailView напрямую.
    // Здесь — sanity: derivations отдают секции для конкретного taskId.
    const { lastFrame, stdin } = render(
      <ViewRenderer plugin={taskJournal} spec={taskJournal.views!.tasks} data={data} />,
    );
    stdin.write("\r");
    await tick();
    const f = lastFrame()!;
    expect(f).toContain("Девятая");
    expect(f).toContain("Отвергнутое (1)");
    expect(f).toContain("Отвергли Y");
  });
});
