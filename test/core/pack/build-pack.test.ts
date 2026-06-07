import { describe, it, expect } from "vitest";
import { buildPack } from "../../../src/core/pack/build-pack.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function emptyData(): WorkspaceData {
  return { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [],
    taskEvents: [], tasks: [], projectId: "", errors: [] } as any;
}

describe("buildPack каркас", () => {
  it("начинается с # Workspace pack и содержит Project", () => {
    const md = buildPack({ data: emptyData(), config: { projectName: "demo" } });
    expect(md.startsWith("# Workspace pack")).toBe(true);
    expect(md).toContain("Project: demo");
  });
  it("Project: — при отсутствии имени", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("Project: —");
  });
  it("заканчивается footer-нотой про оценку токенов по времени", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toMatch(/оценка по врем|double-count/i);
  });
  it("детерминирован (один вход → один текст)", () => {
    const a = buildPack({ data: emptyData(), config: { projectName: "x" } });
    const b = buildPack({ data: emptyData(), config: { projectName: "x" } });
    expect(a).toBe(b);
  });
});

describe("sectionProfile", () => {
  it("explicit profile из config", () => {
    const md = buildPack({ data: emptyData(), config: { activeProfile: "work" } });
    expect(md).toContain("## Active profile\n\nwork");
  });
  it("эвристика: профиль последней сессии когда config пуст", () => {
    const data = { ...emptyData(), sessions: [
      { sessionId: "s1", profile: "old", lastUsedAtMs: 100 },
      { sessionId: "s2", profile: "new", lastUsedAtMs: 200 },
    ] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toMatch(/## Active profile\n\nnew \(эвристика/);
  });
  it("недоступно когда нет ни config, ни сессий", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("## Active profile\n\n_недоступно");
  });
  it("детерминированный tie-break по sessionId при равном lastUsedAtMs", () => {
    const data = { ...emptyData(), sessions: [
      { sessionId: "b", profile: "pb", lastUsedAtMs: 0 },
      { sessionId: "a", profile: "pa", lastUsedAtMs: 0 },
    ] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toMatch(/## Active profile\n\npa /);  // sessionId "a" < "b"
  });
});

describe("sectionTask", () => {
  const tasks = [{ id: "tj-1", title: "Alpha", status: "open" }, { id: "tj-2", title: "Beta", status: "closed" }];
  it("explicit task из config", () => {
    const md = buildPack({ data: { ...emptyData(), tasks } as any, config: { activeTaskId: "tj-1" } });
    expect(md).toContain("## Active task\n\ntj-1 — Alpha [open]");
  });
  it("эвристика: первая открытая когда config пуст", () => {
    const md = buildPack({ data: { ...emptyData(), tasks } as any, config: {} });
    expect(md).toMatch(/## Active task\n\ntj-1 — Alpha \[open\] \(эвристика/);
  });
  it("id из config, но нет в tasks → (нет в журнале)", () => {
    const md = buildPack({ data: { ...emptyData(), tasks } as any, config: { activeTaskId: "tj-X" } });
    expect(md).toContain("tj-X — (нет в журнале)");
  });
  it("недоступно когда нет задач", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("## Active task\n\n_недоступно");
  });
});

describe("sectionDecisions/Rejections", () => {
  const taskEvents = [
    { event_id: "e1", task_id: "tj-1", type: "decision", text: "выбрали X", timestamp: "2026-06-01T10:00:00Z" },
    { event_id: "e2", task_id: "tj-1", type: "decision", text: "выбрали Y", timestamp: "2026-06-01T11:00:00Z" },
    { event_id: "e3", task_id: "tj-1", type: "rejection", text: "отвергли Z", timestamp: "2026-06-01T10:30:00Z" },
  ];
  const base = { ...emptyData(), tasks: [{ id: "tj-1", title: "Alpha", status: "open" }], taskEvents } as any;
  it("decisions списком с дефисами", () => {
    const md = buildPack({ data: base, config: { activeTaskId: "tj-1" } });
    expect(md).toContain("## Recent decisions");
    expect(md).toContain("- выбрали X");
    expect(md).toContain("- выбрали Y");
  });
  it("rejections списком", () => {
    const md = buildPack({ data: base, config: { activeTaskId: "tj-1" } });
    expect(md).toContain("## Rejected approaches");
    expect(md).toContain("- отвергли Z");
  });
  it("нет решений → честная заглушка", () => {
    const md = buildPack({ data: { ...emptyData(), tasks: [{ id:"tj-9", title:"E", status:"open" }] } as any, config: { activeTaskId: "tj-9" } });
    expect(md).toMatch(/## Recent decisions\n\n_нет записанных решений_/);
  });
});
