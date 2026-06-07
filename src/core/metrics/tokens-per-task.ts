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
