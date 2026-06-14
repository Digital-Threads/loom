// Orchestrate — the automation capstone: spec → plan (DAG) → route (assign
// agent/model per step) → execute (impl DAG). Plan + execute are injected
// (decomposer, executor) so the whole flow is testable without a model or CLI.

import type Database from "better-sqlite3";
import { getSteps, assignStep } from "../store/steps.js";
import { updateStageStatus } from "../store/db.js";
import { planTask, type Decomposer } from "./planner.js";
import { chooseRoute, type RouteCandidate } from "./router.js";
import { executeImplStage, type StageRunResult } from "./conductor.js";
import type { StepExecutor } from "./exec-loop.js";
import type { SpineIds } from "../spine/ids.js";

export interface OrchestrateDeps {
  decomposer: Decomposer;
  executor: StepExecutor;
}

export interface RunSpecResult {
  steps: number;
  assigned: number;
  unrouted: string[];
  exec: StageRunResult;
}

/**
 * Run a spec end-to-end through the automation pipeline:
 * 1. plan — decompose the spec into a persisted step DAG;
 * 2. route — pick a profile/model per step from the candidates (cheapest
 *    capable with quota); steps that can't be routed are reported, not run-blocked;
 * 3. execute — run the impl-stage DAG via the executor and advance the stage.
 */
export async function runSpec(
  db: Database.Database,
  deps: OrchestrateDeps,
  taskId: string,
  spec: string,
  candidates: RouteCandidate[],
  ids: SpineIds,
): Promise<RunSpecResult> {
  const steps = await planTask(db, deps.decomposer, taskId, spec);

  let assigned = 0;
  const unrouted: string[] = [];
  for (const step of steps) {
    const choice = chooseRoute({ capability: step.agent ?? undefined }, candidates);
    if (choice) {
      assignStep(db, step.id, choice.profile, choice.model);
      assigned += 1;
    } else {
      unrouted.push(step.id);
    }
  }

  updateStageStatus(db, taskId, "impl", "active");
  const exec = await executeImplStage(db, deps.executor, taskId, ids);

  return { steps: getSteps(db, taskId).length, assigned, unrouted, exec };
}
