import { describe, it, expect } from "vitest";
import { sessionsForTask, tokensForTaskBySession } from "../../../src/core/metrics/tokens-per-task.js";

const ev = (task_id: string, session_id?: string) => ({
  event_id: `e-${Math.random()}`, task_id, type: "finding",
  timestamp: "2026-06-01T10:00:00Z", text: "x",
  ...(session_id ? { meta: { session_id } } : {}),
} as any);
const tok = (sessionId: string, used: number, saved = 0, agentType: string | null = null) =>
  ({ sessionId, used, saved, ts: 1000, agentType } as any);

describe("LP13 sessionsForTask", () => {
  it("collects meta.session_id across all task events", () => {
    const events = [ev("A", "s1"), ev("A", "s2"), ev("B", "s3")];
    expect([...sessionsForTask(events, "A")].sort()).toEqual(["s1", "s2"]);
  });
  it("a task event without meta.session_id yields no sessions", () => {
    expect([...sessionsForTask([ev("A")], "A")]).toEqual([]);
  });
});

describe("LP13 tokensForTaskBySession", () => {
  it("sums tokens whose sessionId ∈ the task's sessions; ignores foreign ones", () => {
    const events = [ev("A", "s1")];
    const tokens = [tok("s1", 100, 10), tok("s2", 50, 5)];
    const r = tokensForTaskBySession(events, "A", tokens);
    expect(r.used).toBe(100);
    expect(r.saved).toBe(10);
  });
  it("a subagent (agentType!=null) with the same session is INCLUDED in the sum", () => {
    const events = [ev("A", "s1")];
    const tokens = [tok("s1", 100, 0, null), tok("s1", 40, 0, "subagent")];
    expect(tokensForTaskBySession(events, "A", tokens).used).toBe(140);
  });
  it("multiple sessions of one task are summed", () => {
    const events = [ev("A", "s1"), ev("A", "s2")];
    const tokens = [tok("s1", 100), tok("s2", 50)];
    expect(tokensForTaskBySession(events, "A", tokens).used).toBe(150);
  });
  it("task has no sessions → zeros", () => {
    expect(tokensForTaskBySession([ev("A")], "A", [tok("s1", 100)])).toMatchObject({ used: 0, saved: 0 });
  });
});
