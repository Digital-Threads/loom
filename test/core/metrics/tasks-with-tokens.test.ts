import { describe, it, expect } from "vitest";
import { tasksWithTokens } from "../../../src/core/metrics/tokens-per-task.js";

const ev = (task_id: string, ts: string) => ({ task_id, timestamp: ts } as any);
const tok = (ts: number, used: number, saved = 0) => ({ ts, used, saved, sessionId: "s" } as any);

describe("tasksWithTokens", () => {
  const tasks = [
    { id: "A", title: "Task A", status: "open" },
    { id: "B", title: "Task B", status: "closed" },
  ] as any[];

  it("sums tokens per task by its event-time window (disjoint windows → overlap=false)", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z"), ev("A", "2026-06-01T11:00:00Z"),
                    ev("B", "2026-06-02T10:00:00Z")];
    const tokens = [tok(Date.parse("2026-06-01T10:30:00Z"), 100),
                    tok(Date.parse("2026-06-02T10:00:00Z"), 50)];
    const rows = tasksWithTokens(events, tasks, tokens);
    expect(rows.find((r) => r.id === "A")!.used).toBe(100);
    expect(rows.find((r) => r.id === "B")!.used).toBe(50);
    expect(rows.every((r) => r.overlap === false)).toBe(true);
  });

  it("DOUBLE-COUNTS and FLAGS overlap when task windows overlap", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z"), ev("A", "2026-06-01T12:00:00Z"),
                    ev("B", "2026-06-01T11:00:00Z"), ev("B", "2026-06-01T13:00:00Z")];
    const tokens = [tok(Date.parse("2026-06-01T11:30:00Z"), 100)];
    const rows = tasksWithTokens(events, tasks, tokens);
    expect(rows.find((r) => r.id === "A")!.used).toBe(100);
    expect(rows.find((r) => r.id === "B")!.used).toBe(100);
    expect(rows.find((r) => r.id === "A")!.overlap).toBe(true);
    expect(rows.find((r) => r.id === "B")!.overlap).toBe(true);
  });

  it("single task with events never overlaps", () => {
    const rows = tasksWithTokens(
      [ev("A", "2026-06-01T10:00:00Z"), ev("A", "2026-06-01T12:00:00Z")],
      [{ id: "A", title: "Task A", status: "open" }] as any,
      [tok(Date.parse("2026-06-01T11:00:00Z"), 100)]);
    expect(rows[0].overlap).toBe(false);
    expect(rows[0].used).toBe(100);
  });

  it("task without events is not counted as overlapping", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z"), ev("A", "2026-06-01T12:00:00Z")];
    const rows = tasksWithTokens(events, tasks, []);
    expect(rows.find((r) => r.id === "A")!.overlap).toBe(false);
    expect(rows.find((r) => r.id === "B")!.overlap).toBe(false);
  });

  it("marks every row as an estimate", () => {
    const rows = tasksWithTokens([], tasks, []);
    expect(rows.every((r) => r.estimate === true)).toBe(true);
  });

  it("zeros for tasks with no events", () => {
    const rows = tasksWithTokens([], tasks, [tok(1, 999)]);
    expect(rows.every((r) => r.used === 0 && r.saved === 0)).toBe(true);
  });
});
