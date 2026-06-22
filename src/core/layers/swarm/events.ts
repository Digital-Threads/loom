// L5 swarm — spine events. A swarm run emits a `swarm.run` LoomEvent so the
// Swarm UI's "Past runs" log (which filters type === "swarm" || "swarm.*" and
// reads metrics.{count,total,ratio}) populates, and so cost is attributable.

import { makeEvent, type LoomEvent } from "../../spine/event.js";

export interface SwarmRunSummary {
  projectId: string;
  taskId: string;
  stage: string;
  /** Attempts launched. */
  attempts: number;
  /** Attempts that produced a usable result (the rest failed/were dropped). */
  survivors: number;
  /** How many survivors agreed with the elected winner (consensus count). */
  agree: number;
  /** A short label for the elected result (e.g. winner attempt id / verdict). */
  winner?: string;
  /** Total $ spent across all attempts. */
  costUsd?: number;
  ts: number;
}

/** Sum per-attempt costs into the swarm-run total (per-attempt cost capture). */
export function sumAttemptCost(perAttemptUsd: Array<number | undefined>): number {
  let sum = 0;
  for (const c of perAttemptUsd) if (typeof c === "number" && Number.isFinite(c)) sum += c;
  return sum;
}

/** Build the `swarm.run` event for the spine. metrics.{count,total,ratio} match
 *  exactly what Swarm.tsx renders as "<n>/<m> agreement" / "<pct>% agreement". */
export function swarmRunEvent(s: SwarmRunSummary): LoomEvent {
  const total = Math.max(0, s.survivors);
  const count = Math.max(0, Math.min(s.agree, total));
  const metrics: Record<string, number> = {
    attempts: s.attempts,
    count,
    total,
    ratio: total > 0 ? count / total : 0,
  };
  if (typeof s.costUsd === "number") metrics.costUsd = s.costUsd;
  return makeEvent({
    ts: s.ts,
    source: "loom",
    projectId: s.projectId,
    taskId: s.taskId,
    type: "swarm.run",
    severity: "info",
    metrics,
    message: `Swarm ${s.stage}: ${s.attempts} attempts → ${s.survivors} ok${s.winner ? `, elected ${s.winner}` : ""}`,
  });
}
