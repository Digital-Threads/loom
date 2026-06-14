// Conductor — ties the pipeline engine to the exec-loop. The Реализация stage
// is executed by running the task's step DAG; on success the stage advances, on
// failure it stays active (and the task lands in the attention queue).

import type Database from "better-sqlite3";
import { completeStage } from "../pipeline/engine.js";
import { runDag, type StepExecutor, type DagResult, type LoomEventSink } from "./exec-loop.js";
import type { SpineIds } from "../spine/ids.js";

export interface StageRunResult {
  dag: DagResult;
  /** true when the impl stage completed and advanced. */
  advanced: boolean;
}

/**
 * Execute the implementation stage: run the step DAG via the executor. If every
 * step succeeds, complete the `impl` stage (engine activates the next). On any
 * failure the stage is left active so the task surfaces for attention.
 */
export async function executeImplStage(
  db: Database.Database,
  executor: StepExecutor,
  taskId: string,
  ids: SpineIds,
  cwd?: string,
  emit?: LoomEventSink,
): Promise<StageRunResult> {
  const dag = await runDag(db, executor, taskId, ids, cwd, emit);
  if (dag.ok) {
    completeStage(db, taskId, "impl");
    return { dag, advanced: true };
  }
  return { dag, advanced: false };
}
