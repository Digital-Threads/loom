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

/**
 * Разрешение коллизии «несколько задач в одной сессии» (LP13).
 *
 * Одну session_id могут делить ≥2 задачи во времени (переключение между задачами).
 * Тогда нельзя отнести всю сессию одной задаче. Строим временну́ю шкалу «какая задача
 * была ТЕКУЩЕЙ в каждый момент» по событиям task-journal этой сессии и относим каждый
 * токен по его ts к задаче, текущей в этот момент.
 *
 * Модель текущей задачи — стек открытых задач (most-recently-touched среди открытых):
 *   - open<task>  → task становится текущей (поднимается на вершину стека);
 *   - close<task> → task удаляется; текущей становится новая вершина (или null);
 *   - прочие события → most-recently-touched: task поднимается на вершину (если открыта).
 * Токен относится к задаче, текущей в момент его ts (по последнему событию с
 * timestamp <= ts). Токен раньше первого open → ничей (не приписываем силой).
 *
 * ЧЕСТНОСТЬ: timestamp событий task-journal = ingest-time (не точное event-time),
 * поэтому границы интервалов приблизительны — документированный предел метода.
 * Чистая, детерминированная функция.
 */
export function resolveCollisionByCurrentTask(
  allEvents: TjEvent[],
  sessionId: string,
  tokenEvents: TokenEvent[],
): Map<string, TaskTokens> {
  // События этой сессии, отсортированные по времени (стабильно по event_id при равенстве).
  const events = allEvents
    .filter((e) => (e.meta as { session_id?: unknown } | undefined)?.session_id === sessionId)
    .map((e) => ({ e, ms: Date.parse(e.timestamp) }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.e.event_id < b.e.event_id ? -1 : a.e.event_id > b.e.event_id ? 1 : 0));

  // Временна́я шкала: после обработки каждого события — кто текущая задача (или null).
  // Сегмент действует от ms события (включительно) до ms следующего события.
  const segments: { fromMs: number; task: string | null }[] = [];
  const stack: string[] = []; // открытые задачи, вершина = текущая
  for (const { e, ms } of events) {
    if (e.type === "open") {
      const idx = stack.indexOf(e.task_id);
      if (idx !== -1) stack.splice(idx, 1);
      stack.push(e.task_id);
    } else if (e.type === "close") {
      const idx = stack.indexOf(e.task_id);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      // прочее событие задачи: most-recently-touched среди открытых → поднять на вершину
      const idx = stack.indexOf(e.task_id);
      if (idx !== -1) {
        stack.splice(idx, 1);
        stack.push(e.task_id);
      }
    }
    const current = stack.length > 0 ? stack[stack.length - 1] : null;
    segments.push({ fromMs: ms, task: current });
  }

  const byTask = new Map<string, TaskTokens>();
  for (const t of tokenEvents) {
    if (t.sessionId !== sessionId) continue;
    // Найти последний сегмент с fromMs <= t.ts. Токен раньше первого события → ничей.
    let task: string | null = null;
    for (const seg of segments) {
      if (seg.fromMs <= t.ts) task = seg.task;
      else break;
    }
    if (task === null) continue;
    const agg = byTask.get(task) ?? { used: 0, saved: 0 };
    agg.used += t.used;
    agg.saved += t.saved;
    byTask.set(task, agg);
  }
  return byTask;
}
