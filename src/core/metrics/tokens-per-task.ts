import type { TjEvent } from "../plugins/task-journal/adapter.js";
import type { TokenEvent } from "../plugins/token-pilot/adapter.js";
import type { SessionRow } from "../plugins/aimux/adapter.js";

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
 * Exact per-task token cost: sums only token events tagged with this task_id
 * (the spine — token-pilot stamps task_id when the session was launched by
 * Loom). No time-window heuristic, so no double-count across overlapping tasks.
 */
export function tokensForTaskExact(tokenEvents: TokenEvent[], taskId: string): TaskTokens {
  let used = 0;
  let saved = 0;
  for (const t of tokenEvents) {
    if (t.taskId !== taskId) continue;
    used += t.used;
    saved += t.saved;
  }
  return { used, saved };
}

export interface TaskCost extends TaskTokens {
  /** true = summed from task_id-tagged events; false = time-window estimate. */
  exact: boolean;
}

/**
 * Best available per-task cost: prefers the exact sum over task_id-tagged events
 * (spine active) and falls back to the time-window estimate when no event
 * carries this task_id. `exact` is the honest provenance the UI shows
 * (`exact` vs `≈ estimate`).
 */
export function taskCost(
  allEvents: TjEvent[],
  taskId: string,
  tokenEvents: TokenEvent[],
): TaskCost {
  const hasTagged = tokenEvents.some((t) => t.taskId === taskId);
  if (hasTagged) {
    return { ...tokensForTaskExact(tokenEvents, taskId), exact: true };
  }
  return { ...tokensForTask(allEvents, taskId, tokenEvents), exact: false };
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
 * Sessions of a task: the set of meta.session_id across all events of the task. Pure.
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
 * Exact attribution: tokens whose sessionId is in the task's sessions. Subagents of the same
 * session are included (they work on the same task). Multiple sessions are summed. Pure.
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

export interface BestTokens {
  tokens: TaskTokens;
  mode: "exact" | "estimate";
}

/**
 * exact vs estimate selector (LP13). If the task has sessions (meta.session_id),
 * we take exact attribution via session-join (tokensForTaskBySession) -> mode="exact".
 * Otherwise fall back to the LP4 time window (tokensForTask) -> mode="estimate".
 * No data -> zeros. Pure.
 *
 * NOTE (next step): resolveCollisionByCurrentTask (T5) is already tested and
 * gets wired in when a task's session is shared by >=2 tasks. For now we use the direct
 * session-join as the exact value -- for one task per session this is the correct
 * sum; the collision resolver integrates without changing mode (still exact).
 */
export function tokensForTaskBest(
  allEvents: TjEvent[],
  taskId: string,
  tokenEvents: TokenEvent[],
): BestTokens {
  const sessions = sessionsForTask(allEvents, taskId);
  if (sessions.size > 0) {
    return { tokens: tokensForTaskBySession(allEvents, taskId, tokenEvents), mode: "exact" };
  }
  return { tokens: tokensForTask(allEvents, taskId, tokenEvents), mode: "estimate" };
}

export interface TaskWithTokens {
  id: string;
  title: string;
  status: string;
  used: number;
  saved: number;
  estimate: boolean;
  mode: "exact" | "estimate";
  overlap: boolean;
}

/** Task window [min..max] of its events' ts (inclusive). null -- no events. */
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

/** Whether two inclusive windows overlap. */
export function taskWindowsOverlap(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): boolean {
  return a.startMs <= b.endMs && b.startMs <= a.endMs;
}

/**
 * Aggregator: tokens per task (tokensForTask over window [min..max]) + an overlap flag.
 * KNOWN double-count HOLE: task windows overlap (side-quests, background, 2 projects) ->
 * a token in the intersection is counted in BOTH tasks -> total used is inflated. Without a task_id label on the token
 * it cannot be split (plugins are independent). overlap=true -> the number is UNRELIABLE, the UI won't show it as fact.
 * A task with no events (no window) -> overlap=false. See .docs/loom/dashboard/correlation-accuracy.md.
 */
export function tasksWithTokens(
  allEvents: TjEvent[],
  tasks: { id: string; title: string; status: string }[],
  tokenEvents: TokenEvent[],
): TaskWithTokens[] {
  const windows = new Map<string, { startMs: number; endMs: number } | null>();
  for (const t of tasks) windows.set(t.id, taskWindow(allEvents, t.id));

  return tasks.map((t) => {
    const best = tokensForTaskBest(allEvents, t.id, tokenEvents);
    const { used, saved } = best.tokens;
    const win = windows.get(t.id) ?? null;
    const overlap = win
      ? tasks.some((o) => {
          if (o.id === t.id) return false;
          const ow = windows.get(o.id);
          return ow ? taskWindowsOverlap(win, ow) : false;
        })
      : false;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      used,
      saved,
      estimate: best.mode !== "exact",
      mode: best.mode,
      overlap,
    };
  });
}

/**
 * Resolving the "several tasks in one session" collision (LP13).
 *
 * A single session_id may be shared by >=2 tasks over time (switching between tasks).
 * Then the whole session cannot be attributed to one task. We build a timeline of "which task
 * was CURRENT at each moment" from this session's task-journal events and attribute each
 * token by its ts to the task current at that moment.
 *
 * The current-task model is a stack of open tasks (most-recently-touched among the open ones):
 *   - open<task>  -> task becomes current (rises to the top of the stack);
 *   - close<task> -> task is removed; the new top becomes current (or null);
 *   - other events -> most-recently-touched: the task rises to the top (if open).
 * A token is attributed to the task current at the moment of its ts (by the last event with
 * timestamp <= ts). A token before the first open -> nobody's (we don't force an attribution).
 *
 * HONESTY: task-journal event timestamps are ingest-time (not exact event-time),
 * so interval boundaries are approximate -- a documented limit of the method.
 * Pure, deterministic function.
 */
export function resolveCollisionByCurrentTask(
  allEvents: TjEvent[],
  sessionId: string,
  tokenEvents: TokenEvent[],
): Map<string, TaskTokens> {
  // This session's events, sorted by time (stable by event_id on ties).
  const events = allEvents
    .filter((e) => (e.meta as { session_id?: unknown } | undefined)?.session_id === sessionId)
    .map((e) => ({ e, ms: Date.parse(e.timestamp) }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.e.event_id < b.e.event_id ? -1 : a.e.event_id > b.e.event_id ? 1 : 0));

  // Timeline: after processing each event -- which task is current (or null).
  // A segment is in effect from the event's ms (inclusive) until the next event's ms.
  const segments: { fromMs: number; task: string | null }[] = [];
  const stack: string[] = []; // open tasks, top = current
  for (const { e, ms } of events) {
    if (e.type === "open") {
      const idx = stack.indexOf(e.task_id);
      if (idx !== -1) stack.splice(idx, 1);
      stack.push(e.task_id);
    } else if (e.type === "close") {
      const idx = stack.indexOf(e.task_id);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      // other task event: most-recently-touched among the open ones -> raise to the top
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
    // Find the last segment with fromMs <= t.ts. A token before the first event -> nobody's.
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
