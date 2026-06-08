import type { TjEvent } from "@digital-threads/loom-plugin-task-journal";
import type { TokenEvent } from "@digital-threads/loom-plugin-token-pilot";
import type { SessionRow } from "@digital-threads/loom-plugin-aimux";

export interface TaskTokens {
  used: number;
  saved: number;
}

export interface SessionTokenBreakdown {
  sessionId: string;
  profile: string;
  used: number;
  saved: number;
}

/**
 * Correlate raw token events to a task by the task's event-time window
 * [min..max] of its TjEvent timestamps. Sums token usage of every event
 * whose ts falls within the window (inclusive). No task events → zeros.
 */
export function tokensForTask(
  allEvents: TjEvent[],
  taskId: string,
  tokenEvents: TokenEvent[],
): TaskTokens {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const e of allEvents) {
    if (e.task_id !== taskId) continue;
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms < startMs) startMs = ms;
    if (ms > endMs) endMs = ms;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { used: 0, saved: 0 };
  }

  let used = 0;
  let saved = 0;
  for (const t of tokenEvents) {
    if (t.ts < startMs || t.ts > endMs) continue;
    used += t.used;
    saved += t.saved;
  }
  return { used, saved };
}

/**
 * Per-session breakdown of token usage within a task's event-time window.
 * Groups in-window token events by sessionId, joins the aimux profile
 * (unknown session → "—"), and sorts by used desc (tie-break: saved desc,
 * then sessionId asc). No task events → [].
 */
export function tokensBySessionForTask(
  allEvents: TjEvent[],
  taskId: string,
  tokenEvents: TokenEvent[],
  sessions: SessionRow[],
): SessionTokenBreakdown[] {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const e of allEvents) {
    if (e.task_id !== taskId) continue;
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms < startMs) startMs = ms;
    if (ms > endMs) endMs = ms;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return [];
  }

  const profileBySession = new Map<string, string>();
  for (const s of sessions) profileBySession.set(s.sessionId, s.profile);

  const bySession = new Map<string, { used: number; saved: number }>();
  for (const t of tokenEvents) {
    if (t.ts < startMs || t.ts > endMs) continue;
    const agg = bySession.get(t.sessionId) ?? { used: 0, saved: 0 };
    agg.used += t.used;
    agg.saved += t.saved;
    bySession.set(t.sessionId, agg);
  }

  const rows: SessionTokenBreakdown[] = [];
  for (const [sessionId, agg] of bySession) {
    rows.push({
      sessionId,
      profile: profileBySession.get(sessionId) ?? "—",
      used: agg.used,
      saved: agg.saved,
    });
  }

  rows.sort((a, b) => {
    if (b.used !== a.used) return b.used - a.used;
    if (b.saved !== a.saved) return b.saved - a.saved;
    return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
  });
  return rows;
}

/**
 * Сессии задачи: множество meta.session_id по всем событиям задачи. Чистая.
 */
export function sessionsForTask(allEvents: TjEvent[], taskId: string): Set<string> {
  const out = new Set<string>();
  for (const e of allEvents) {
    if (e.task_id !== taskId) continue;
    const sid = (e.meta as { session_id?: unknown } | undefined)?.session_id;
    if (typeof sid === "string" && sid) out.add(sid);
  }
  return out;
}

/**
 * Точная атрибуция (exact): токены, чей sessionId ∈ сессии задачи. Сабагенты той же
 * сессии включены (работают на ту же задачу). Несколько сессий — суммируются. Чистая.
 */
export function tokensForTaskBySession(
  allEvents: TjEvent[],
  taskId: string,
  tokenEvents: TokenEvent[],
): TaskTokens {
  const sessions = sessionsForTask(allEvents, taskId);
  let used = 0;
  let saved = 0;
  for (const t of tokenEvents) {
    if (!sessions.has(t.sessionId)) continue;
    used += t.used;
    saved += t.saved;
  }
  return { used, saved };
}

export interface TaskWithTokens {
  id: string;
  title: string;
  status: string;
  used: number;
  saved: number;
  estimate: true;
  overlap: boolean;
}

/** Окно задачи [min..max] ts её событий (inclusive). null — событий нет. */
export function taskWindow(allEvents: TjEvent[], taskId: string): { startMs: number; endMs: number } | null {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const e of allEvents) {
    if (e.task_id !== taskId) continue;
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms < startMs) startMs = ms;
    if (ms > endMs) endMs = ms;
  }
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? { startMs, endMs } : null;
}

/** Пересекаются ли два инклюзивных окна. */
export function taskWindowsOverlap(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): boolean {
  return a.startMs <= b.endMs && b.startMs <= a.endMs;
}

/**
 * Агрегатор: токены на каждую задачу (tokensForTask по окну [min..max]) + флаг overlap.
 * ИЗВЕСТНАЯ ДЫРА double-count: окна задач накладываются (side-quest'ы, фон, 2 проекта) →
 * токен в пересечении учтён в ОБЕИХ задачах → Σ used завышена. Без метки task_id на токене
 * разделить нельзя (плагины независимы). overlap=true → число НЕНАДЁЖНО, UI не покажет как факт.
 * Задача без событий (нет окна) → overlap=false. См. .docs/loom/dashboard/correlation-accuracy.md.
 */
export function tasksWithTokens(
  allEvents: TjEvent[],
  tasks: { id: string; title: string; status: string }[],
  tokenEvents: TokenEvent[],
): TaskWithTokens[] {
  const windows = new Map<string, { startMs: number; endMs: number } | null>();
  for (const t of tasks) windows.set(t.id, taskWindow(allEvents, t.id));

  return tasks.map((t) => {
    const { used, saved } = tokensForTask(allEvents, t.id, tokenEvents);
    const win = windows.get(t.id) ?? null;
    const overlap = win
      ? tasks.some((o) => {
          if (o.id === t.id) return false;
          const ow = windows.get(o.id);
          return ow ? taskWindowsOverlap(win, ow) : false;
        })
      : false;
    return { id: t.id, title: t.title, status: t.status, used, saved, estimate: true, overlap };
  });
}
