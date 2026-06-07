import { describe, it, expect } from "vitest";
import { derivations } from "../../../src/core/views/derivations.js";

const data = {
  subscriptions: [{}], sessions: [{ sessionId: "s", profile: "p", lastUsedAtMs: 0 }],
  tokens: [], tokenEvents: [{ ts: Date.parse("2026-06-01T10:30:00Z"), used: 10, saved: 2, sessionId: "s" }],
  taskEvents: [{ task_id: "A", timestamp: "2026-06-01T10:00:00Z" },
               { task_id: "A", timestamp: "2026-06-01T11:00:00Z" }],
  tasks: [{ id: "A", title: "Alpha", status: "open" }], projectId: "x", errors: [],
} as any;

describe("dashboard derivations", () => {
  it("tasksWithTokensRows returns rows with token columns; single task → exact number", () => {
    const rows = derivations.tasksWithTokensRows(data) as any[];
    expect(rows[0]).toMatchObject({ id: "A", title: "Alpha", used: 10, saved: 2 });
    expect(rows[0].overlap).toBe(false);
    expect(rows[0].tokens).toBe("10/2");
  });

  it("hides exact number for overlapping tasks (≈ перекрытие)", () => {
    const overlapping = {
      ...data,
      taskEvents: [
        { task_id: "A", timestamp: "2026-06-01T10:00:00Z" },
        { task_id: "A", timestamp: "2026-06-01T12:00:00Z" },
        { task_id: "B", timestamp: "2026-06-01T11:00:00Z" },
        { task_id: "B", timestamp: "2026-06-01T13:00:00Z" },
      ],
      tasks: [{ id: "A", title: "Alpha", status: "open" }, { id: "B", title: "Beta", status: "open" }],
    } as any;
    const rows = derivations.tasksWithTokensRows(overlapping) as any[];
    const a = rows.find((r) => r.id === "A");
    expect(a.overlap).toBe(true);
    expect(a.tokens).toMatch(/≈|перекрыт/);
    expect(a.tokens).not.toBe(`${a.used}/${a.saved}`);
  });

  it("layerSummaryLines returns one line per present layer in LAYER_ORDER", () => {
    const lines = derivations.layerSummaryLines(data) as Array<{ text: string }>;
    expect(lines[0].text).toMatch(/Доступ/);
    expect(lines.some((l) => /Память/.test(l.text))).toBe(true);
  });
});
