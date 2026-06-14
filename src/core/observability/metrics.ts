// Observability — metrics derived from the unified LoomEvent stream (spine
// normalize output) and rolled into the core store. Pure over events; the store
// write is a thin helper. Honest provenance: token metrics from token-pilot are
// estimates; spend should be backed by aimux usage where available.

import type Database from "better-sqlite3";
import type { LoomEvent } from "../spine/event.js";
import { upsertCost } from "../store/execute.js";

export interface TaskRollup {
  taskId: string;
  events: number;
  used: number;
  saved: number;
  firstTs: number | null;
  lastTs: number | null;
  durationMs: number;
}

/** Aggregate one task's metrics from the LoomEvent stream. */
export function taskRollup(events: LoomEvent[], taskId: string): TaskRollup {
  let used = 0;
  let saved = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const e of events) {
    if (e.taskId !== taskId) continue;
    count += 1;
    if (e.ts < first) first = e.ts;
    if (e.ts > last) last = e.ts;
    if (e.source === "token-pilot" && e.metrics) {
      used += e.metrics.used ?? 0;
      saved += e.metrics.saved ?? 0;
    }
  }

  const has = count > 0;
  return {
    taskId,
    events: count,
    used,
    saved,
    firstTs: has ? first : null,
    lastTs: has ? last : null,
    durationMs: has ? last - first : 0,
  };
}

export interface BoardTotals {
  used: number;
  saved: number;
  events: number;
}

/** Project-wide totals across all events. */
export function boardTotals(events: LoomEvent[]): BoardTotals {
  let used = 0;
  let saved = 0;
  for (const e of events) {
    if (e.source === "token-pilot" && e.metrics) {
      used += e.metrics.used ?? 0;
      saved += e.metrics.saved ?? 0;
    }
  }
  return { used, saved, events: events.length };
}

/** Persist a task's token-pilot rollup into cost_rollups (saved + used).
 *  `exact` reflects whether the events were task_id-tagged (spine-linked). */
export function rollupToStore(
  db: Database.Database,
  rollup: TaskRollup,
  exact: boolean,
): void {
  upsertCost(db, rollup.taskId, "token-pilot", "saved", rollup.saved, exact);
  upsertCost(db, rollup.taskId, "token-pilot", "used", rollup.used, exact);
}

export interface SessionSpend {
  sessionId: string;
  /** Total tokens spent in the session (aimux usage; e.g. totalTokens()). */
  total: number;
}

/** Sum the real spend (from aimux usage) over the sessions belonging to a task.
 *  Decoupled from aimux types: caller passes {sessionId,total} rows + the task's
 *  session ids (e.g. from sessionsForTask). */
export function spentForTask(rows: SessionSpend[], sessionIds: string[]): number {
  const set = new Set(sessionIds);
  let spent = 0;
  for (const r of rows) if (set.has(r.sessionId)) spent += r.total;
  return spent;
}

/** Persist a task's real spend into cost_rollups (source: aimux). `exact` =
 *  spine-linked (sessions tied to the task). */
export function recordSpend(
  db: Database.Database,
  taskId: string,
  spent: number,
  exact: boolean,
): void {
  upsertCost(db, taskId, "aimux", "spent", spent, exact);
}
