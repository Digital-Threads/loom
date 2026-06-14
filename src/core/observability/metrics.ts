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

export interface AgentPerf {
  profile: string;
  runs: number;
  failures: number;
  durationMs: number;
}

/** Agent performance per profile, from run.completed events (L9.3). Feeds the
 *  learning layer (L8) and the Accounts/Timeline panels. */
export function agentPerformance(events: LoomEvent[]): AgentPerf[] {
  const by = new Map<string, AgentPerf>();
  for (const e of events) {
    if (e.type !== "run.completed" || !e.profileId) continue;
    const p = by.get(e.profileId) ?? { profile: e.profileId, runs: 0, failures: 0, durationMs: 0 };
    p.runs += 1;
    if ((e.metrics?.failed ?? 0) > 0 || e.severity === "error") p.failures += 1;
    p.durationMs += e.metrics?.durationMs ?? 0;
    by.set(e.profileId, p);
  }
  return [...by.values()];
}

export interface FailureReason {
  message: string;
  count: number;
}

/** Failure reasons from failed steps/runs (L9.3) — categorised by message. */
export function failureReasons(events: LoomEvent[]): FailureReason[] {
  const by = new Map<string, number>();
  for (const e of events) {
    const failed = e.severity === "error" && (e.type === "step.completed" || e.type === "run.completed" || e.type === "run.failed");
    if (!failed) continue;
    const key = e.message || e.type;
    by.set(key, (by.get(key) ?? 0) + 1);
  }
  return [...by.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count);
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
