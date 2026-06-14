// Automation exec-loop — runs a task's step DAG in dependency waves, recording
// runs in the core store. The actual agent launch is injected as a StepExecutor
// (the real one wraps aimux runProfileHeadless with the spine env); this keeps
// the orchestration logic pure and testable, and the engine swappable.

import type Database from "better-sqlite3";
import { getSteps, updateStepStatus, stepDeps, type StepRow } from "../store/steps.js";
import { insertRun, completeRun } from "../store/execute.js";
import type { SpineIds } from "../spine/ids.js";

export interface ExecRequest {
  taskId: string;
  step: StepRow;
  ids: SpineIds;
  /** Working directory for the run (e.g. the sandbox worktree). */
  cwd?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  sessionId?: string;
}

export interface StepExecutor {
  run(req: ExecRequest): Promise<ExecResult>;
}

/**
 * Layer steps into dependency waves: wave[0] has no deps, each later wave only
 * depends on steps in earlier waves. Steps with unknown/cyclic deps that never
 * become satisfiable are dropped from the schedule (caller can detect the gap).
 */
export function waves(steps: StepRow[]): StepRow[][] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = new Set<string>();
  const result: StepRow[][] = [];
  let remaining = steps.slice();

  while (remaining.length > 0) {
    const ready = remaining.filter((s) =>
      stepDeps(s).every((d) => !byId.has(d) || done.has(d)),
    );
    if (ready.length === 0) break; // cycle / unsatisfiable — stop
    result.push(ready);
    for (const s of ready) done.add(s.id);
    const readyIds = new Set(ready.map((s) => s.id));
    remaining = remaining.filter((s) => !readyIds.has(s.id));
  }
  return result;
}

/** Run one step: record a run, execute via the injected executor, persist the
 *  outcome, update the step status. Never throws — executor errors become a
 *  failed run. */
export async function runStep(
  db: Database.Database,
  executor: StepExecutor,
  taskId: string,
  step: StepRow,
  ids: SpineIds,
  cwd?: string,
): Promise<ExecResult> {
  const runId = `run-${step.id}`;
  updateStepStatus(db, step.id, "running");
  insertRun(db, {
    id: runId,
    taskId,
    stepId: step.id,
    workflowId: ids.workflowId,
    profile: step.profile ?? ids.profileId,
  });

  let res: ExecResult;
  try {
    res = await executor.run({ taskId, step, ids, cwd });
  } catch (e) {
    res = { exitCode: 1, stderr: (e as Error).message };
  }

  completeRun(db, runId, res.exitCode, res.stdout, res.stderr);
  updateStepStatus(db, step.id, res.exitCode === 0 ? "done" : "failed", res.exitCode);
  return res;
}

export interface DagResult {
  ran: number;
  failed: number;
  /** true when every step ran and exited 0. */
  ok: boolean;
}

/**
 * Run the whole task DAG: each wave in parallel, waves in order. Stops launching
 * further waves once a step fails (a failed dependency must not run dependents).
 */
export async function runDag(
  db: Database.Database,
  executor: StepExecutor,
  taskId: string,
  ids: SpineIds,
  cwd?: string,
): Promise<DagResult> {
  const steps = getSteps(db, taskId);
  let ran = 0;
  let failed = 0;

  for (const wave of waves(steps)) {
    const results = await Promise.all(
      wave.map((s) => runStep(db, executor, taskId, s, ids, cwd)),
    );
    for (const r of results) {
      ran += 1;
      if (r.exitCode !== 0) failed += 1;
    }
    if (failed > 0) break; // don't run dependents of a failed wave
  }

  return { ran, failed, ok: failed === 0 && ran === steps.length };
}
