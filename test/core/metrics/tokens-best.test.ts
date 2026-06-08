import { describe, it, expect } from "vitest";
import { tokensForTaskBest } from "../../../src/core/metrics/tokens-per-task.js";

const ev = (task_id: string, ts: string, session_id?: string) => ({
  event_id: `e-${task_id}-${ts}`, task_id, type: "finding", timestamp: ts, text: "x",
  ...(session_id ? { meta: { session_id } } : {}),
} as any);
const tok = (sessionId: string, used: number, ts: number) => ({ sessionId, used, saved: 0, ts, agentType: null } as any);

describe("LP13 tokensForTaskBest", () => {
  it("есть сессии и токены join'ятся по session → mode exact, значение из session-join", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z", "s1")];
    const tokens = [tok("s1", 100, Date.parse("2026-06-01T10:30:00Z")), tok("s2", 50, Date.parse("2026-06-01T10:30:00Z"))];
    const r = tokensForTaskBest(events, "A", tokens);
    expect(r.mode).toBe("exact");
    expect(r.tokens.used).toBe(100); // только s1
  });
  it("у задачи нет meta.session_id → fallback estimate (окно времени)", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z"), ev("A", "2026-06-01T11:00:00Z")];
    const tokens = [tok("s1", 100, Date.parse("2026-06-01T10:30:00Z"))]; // в окне задачи
    const r = tokensForTaskBest(events, "A", tokens);
    expect(r.mode).toBe("estimate");
    expect(r.tokens.used).toBe(100); // по окну
  });
  it("нет токенов вообще → нули (mode estimate, не падает)", () => {
    const r = tokensForTaskBest([ev("A", "2026-06-01T10:00:00Z")], "A", []);
    expect(r.tokens.used).toBe(0);
  });
  it("задача с сессиями, но токен без совпадающего session → не exact-сумма (0 в exact), может уйти в estimate=0", () => {
    const events = [ev("A", "2026-06-01T10:00:00Z", "s1")];
    const tokens = [tok("s9", 100, Date.parse("2026-06-01T10:30:00Z"))];
    const r = tokensForTaskBest(events, "A", tokens);
    // session-join даёт 0 (s9∉{s1}); mode exact (сессии есть), used 0
    expect(r.tokens.used).toBe(0);
  });
});
