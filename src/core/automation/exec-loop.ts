// Automation exec-loop — runs a task's step DAG in dependency waves, recording
// runs in the core store. The actual agent launch is injected as a StepExecutor
// (the real one wraps aimux runProfileHeadless with the spine env); this keeps
// the orchestration logic pure and testable, and the engine swappable.

import type Database from "better-sqlite3";
import { getSteps, updateStepStatus, stepDeps, type StepRow } from "../store/steps.js";
import { insertRun, completeRun } from "../store/execute.js";
import type { SpineIds } from "../spine/ids.js";
import { makeEvent, type LoomEvent } from "../spine/event.js";
import { appendLoomEvent } from "../spine/event-bus.js";

/** Where exec-loop emits its run/step lifecycle events. Injected so the loop
 *  stays pure/testable; the run-manager wires it to the event bus via busSink. */
export type LoomEventSink = (e: LoomEvent) => void;
const NO_EMIT: LoomEventSink = () => {};

/** A sink that appends to the file event bus for the given project. */
export function busSink(projectId: string): LoomEventSink {
  return (e) => appendLoomEvent(projectId, e);
}

/** Build a run/step lifecycle event from the spine ids. */
function lifecycleEvent(
  ids: SpineIds,
  type: string,
  extra?: { message?: string; metrics?: Record<string, number>; severity?: LoomEvent["severity"] },
): LoomEvent {
  return makeEvent({
    ts: Date.now(),
    source: "loom",
    projectId: ids.projectId,
    profileId: ids.profileId,
    taskId: ids.taskId,
    workflowId: ids.workflowId,
    type,
    ...extra,
  });
}

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
  emit: LoomEventSink = NO_EMIT,
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
  emit(lifecycleEvent(ids, "step.started", { message: step.id }));

  const startedAt = Date.now();
  let res: ExecResult;
  try {
    res = await executor.run({ taskId, step, ids, cwd });
  } catch (e) {
    res = { exitCode: 1, stderr: (e as Error).message };
  }

  completeRun(db, runId, res.exitCode, res.stdout, res.stderr);
  updateStepStatus(db, step.id, res.exitCode === 0 ? "done" : "failed", res.exitCode);
  emit(
    lifecycleEvent(ids, "step.completed", {
      message: step.id,
      metrics: { exitCode: res.exitCode, durationMs: Date.now() - startedAt },
      severity: res.exitCode === 0 ? "info" : "error",
    }),
  );
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
  emit: LoomEventSink = NO_EMIT,
): Promise<DagResult> {
  const steps = getSteps(db, taskId);
  let ran = 0;
  let failed = 0;

  const startedAt = Date.now();
  emit(lifecycleEvent(ids, "run.started", { metrics: { steps: steps.length } }));

  for (const wave of waves(steps)) {
    const results = await Promise.all(
      wave.map((s) => runStep(db, executor, taskId, s, ids, cwd, emit)),
    );
    for (const r of results) {
      ran += 1;
      if (r.exitCode !== 0) failed += 1;
    }
    if (failed > 0) break; // don't run dependents of a failed wave
  }

  const ok = failed === 0 && ran === steps.length;
  emit(
    lifecycleEvent(ids, "run.completed", {
      metrics: { ran, failed, durationMs: Date.now() - startedAt },
      severity: ok ? "info" : "error",
    }),
  );

  return { ran, failed, ok };
}
