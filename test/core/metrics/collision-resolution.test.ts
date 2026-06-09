import { describe, it, expect } from "vitest";
import { resolveCollisionByCurrentTask } from "../../../src/core/metrics/tokens-per-task.js";

// events of one session s1: A opened, then B opened, B closed, then work on A, A closed
const tj = (task_id: string, type: string, t: string) => ({
  event_id: `e-${task_id}-${type}-${t}`, task_id, type, timestamp: t, text: "x", meta: { session_id: "s1" },
} as any);
const tok = (ts: number, used: number) => ({ sessionId: "s1", used, saved: 0, ts, agentType: null } as any);

describe("LP13 resolveCollisionByCurrentTask", () => {
  it("attributes a token to the task current at its ts (within the shared session)", () => {
    const events = [
      tj("A", "open",    "2026-06-01T10:00:00Z"),  // A current from 10:00
      tj("B", "open",    "2026-06-01T11:00:00Z"),  // B current from 11:00
      tj("B", "close",   "2026-06-01T12:00:00Z"),  // B closed → A is current again
      tj("A", "finding", "2026-06-01T12:30:00Z"),
      tj("A", "close",   "2026-06-01T13:00:00Z"),
    ];
    const tokens = [
      tok(Date.parse("2026-06-01T10:30:00Z"), 10), // during A → A
      tok(Date.parse("2026-06-01T11:30:00Z"), 20), // during B → B
      tok(Date.parse("2026-06-01T12:45:00Z"), 30), // A again → A
    ];
    // the function returns Map<taskId, TaskTokens> for the session's tasks
    const byTask = resolveCollisionByCurrentTask(events, "s1", tokens);
    expect(byTask.get("A")?.used).toBe(40); // 10 + 30
    expect(byTask.get("B")?.used).toBe(20);
  });

  it("a token before the first open → attributed to no one (or the first opened) — deterministically", () => {
    const events = [tj("A", "open", "2026-06-01T10:00:00Z")];
    const tokens = [tok(Date.parse("2026-06-01T09:00:00Z"), 5)];
    const byTask = resolveCollisionByCurrentTask(events, "s1", tokens);
    // a token before any task is opened: A is not yet current → not in A (used 0 for A, or A is absent)
    expect(byTask.get("A")?.used ?? 0).toBe(0);
  });
});
