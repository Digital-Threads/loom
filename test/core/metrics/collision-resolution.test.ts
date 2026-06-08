import { describe, it, expect } from "vitest";
import { resolveCollisionByCurrentTask } from "../../../src/core/metrics/tokens-per-task.js";

// события одной сессии s1: A открыта, потом открыта B, B закрыта, потом работа по A, A закрыта
const tj = (task_id: string, type: string, t: string) => ({
  event_id: `e-${task_id}-${type}-${t}`, task_id, type, timestamp: t, text: "x", meta: { session_id: "s1" },
} as any);
const tok = (ts: number, used: number) => ({ sessionId: "s1", used, saved: 0, ts, agentType: null } as any);

describe("LP13 resolveCollisionByCurrentTask", () => {
  it("относит токен к задаче, текущей в его ts (внутри общей сессии)", () => {
    const events = [
      tj("A", "open",    "2026-06-01T10:00:00Z"),  // A текущая с 10:00
      tj("B", "open",    "2026-06-01T11:00:00Z"),  // B текущая с 11:00
      tj("B", "close",   "2026-06-01T12:00:00Z"),  // B закрыта → текущая снова A
      tj("A", "finding", "2026-06-01T12:30:00Z"),
      tj("A", "close",   "2026-06-01T13:00:00Z"),
    ];
    const tokens = [
      tok(Date.parse("2026-06-01T10:30:00Z"), 10), // во время A → A
      tok(Date.parse("2026-06-01T11:30:00Z"), 20), // во время B → B
      tok(Date.parse("2026-06-01T12:45:00Z"), 30), // снова A → A
    ];
    // функция возвращает Map<taskId, TaskTokens> для задач сессии
    const byTask = resolveCollisionByCurrentTask(events, "s1", tokens);
    expect(byTask.get("A")?.used).toBe(40); // 10 + 30
    expect(byTask.get("B")?.used).toBe(20);
  });

  it("токен раньше первого open → не приписан никому (или первой открытой) — детерминированно", () => {
    const events = [tj("A", "open", "2026-06-01T10:00:00Z")];
    const tokens = [tok(Date.parse("2026-06-01T09:00:00Z"), 5)];
    const byTask = resolveCollisionByCurrentTask(events, "s1", tokens);
    // токен до открытия любой задачи: A ещё не текущая → не в A (used 0 у A или A отсутствует)
    expect(byTask.get("A")?.used ?? 0).toBe(0);
  });
});
