import type { TjEvent } from "../plugins/task-journal/adapter.js";
import type { TokenEvent } from "../plugins/token-pilot/adapter.js";

export interface TaskTokens {
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
