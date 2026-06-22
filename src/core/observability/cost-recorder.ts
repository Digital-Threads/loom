// Cost-recorder (L9.1) — closes Bible §5 gap 4: persist a task's cost into
// cost_rollups so the UI Cost block stops showing "—". Reads exact per-task
// token usage (spine-tagged token-pilot events) and writes used/saved; optional
// real spend (aimux usage) when session totals are supplied. Called on
// run.completed (and could be flushed periodically — noted in the spec).
import type Database from "better-sqlite3";
import { tokensForTaskExact } from "../metrics/tokens-per-task.js";
import { recordSpend } from "./metrics.js";
import { upsertCost } from "../store/execute.js";
import type { TokenEvent } from "../plugins/token-pilot/adapter.js";

export interface RecordCostInput {
  tokenEvents: TokenEvent[];
  /** Real spend already summed for this task (aimux usage); omit if unknown. */
  spent?: number;
  /** The session `spent` belongs to — lets recordSpend accumulate across
   *  sessions instead of overwriting (loom-0wrw). */
  sessionId?: string;
  /** Provenance: spine-linked (task_id-tagged) → exact, else ≈estimate. */
  exact?: boolean;
  /** MCP tool-call savings (token-pilot's tool-calls.jsonl), attributed by the
   *  task's session ids rather than task_id — added on top of the hook-event
   *  totals so used/saved reflect the agent's actual token-pilot tool use. */
  extra?: { used: number; saved: number };
}

export function recordRunCost(db: Database.Database, taskId: string, input: RecordCostInput): void {
  const exact = input.exact ?? true;
  const t = tokensForTaskExact(input.tokenEvents, taskId);
  const used = t.used + (input.extra?.used ?? 0);
  const saved = t.saved + (input.extra?.saved ?? 0);
  upsertCost(db, taskId, "token-pilot", "used", used, exact);
  upsertCost(db, taskId, "token-pilot", "saved", saved, exact);
  if (input.spent !== undefined) recordSpend(db, taskId, input.spent, exact, input.sessionId);
}
