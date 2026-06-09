import { describe, it, expect } from "vitest";
import { tokensForTaskBest } from "../../../src/core/metrics/tokens-per-task.js";

const ev = (task_id: string, ts: string, session_id?: string) => ({
  event_id: `e-${task_id}-${ts}`, task_id, type: "finding", timestamp: ts, text: "x",
  ...(session_id ? { meta: { session_id } } : {}),
} as any);
const tok = (sessionId: string, used: number, ts: number) => ({ sessionId, used, saved: 0, ts, agentType: null } as any);

describe("LP13 tokensForTaskBest", () => {
  it("sessions exist and tokens join by session → mode exact, value from the session join", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z", "s1")];
    const tokens = [tok("s1", 100, Date.parse("2026-06-01T10:30:00Z")), tok("s2", 50, Date.parse("2026-06-01T10:30:00Z"))];
    const r = tokensForTaskBest(events, "A", tokens);
    expect(r.mode).toBe("exact");
    expect(r.tokens.used).toBe(100); // s1 only
  });
  it("task has no meta.session_id → fallback estimate (time window)", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z"), ev("A", "2026-06-01T11:00:00Z")];
    const tokens = [tok("s1", 100, Date.parse("2026-06-01T10:30:00Z"))]; // within the task window
    const r = tokensForTaskBest(events, "A", tokens);
    expect(r.mode).toBe("estimate");
    expect(r.tokens.used).toBe(100); // by window
  });
  it("no tokens at all → zeros (mode estimate, does not crash)", () => {
    const r = tokensForTaskBest([ev("A", "2026-06-01T10:00:00Z")], "A", []);
    expect(r.tokens.used).toBe(0);
  });
  it("task with sessions but a token without a matching session → not an exact sum (0 in exact), may fall back to estimate=0", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z", "s1")];
    const tokens = [tok("s9", 100, Date.parse("2026-06-01T10:30:00Z"))];
    const r = tokensForTaskBest(events, "A", tokens);
    // the session join yields 0 (s9∉{s1}); mode exact (sessions exist), used 0
    expect(r.tokens.used).toBe(0);
  });
});
