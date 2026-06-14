// Orchestrate — the automation capstone: spec → plan (DAG) → route (assign
// agent/model per step) → execute (impl DAG). Plan + execute are injected
// (decomposer, executor) so the whole flow is testable without a model or CLI.

import type Database from "better-sqlite3";
import { getSteps, assignStep } from "../store/steps.js";
import { updateStageStatus } from "../store/db.js";
import { planTask, type Decomposer } from "./planner.js";
import { chooseRoute, type RouteCandidate } from "./router.js";
import { executeImplStage, type StageRunResult } from "./conductor.js";
import type { StepExecutor, LoomEventSink } from "./exec-loop.js";
import type { SpineIds } from "../spine/ids.js";
import { applyPriors, type Prior } from "../learning/priors.js";
import { prepareWorktree, type GitRunner } from "../security/sandbox.js";

export interface OrchestrateDeps {
  decomposer: Decomposer;
  executor: StepExecutor;
}

export interface RunSpecOptions {
  /** Learning priors — bias the router toward reliable profiles. */
  priors?: Map<string, Prior>;
  /** Run in an isolated git worktree under repoRoot (security). */
  sandbox?: { repoRoot: string; base?: string; git?: GitRunner };
  /** Lifecycle event sink (run-manager wires it to the bus / live stream). */
  emit?: LoomEventSink;
}

export interface RunSpecResult {
  steps: number;
  assigned: number;
  unrouted: string[];
  exec: StageRunResult;
  /** Sandbox worktree path when sandbox was requested. */
  cwd?: string;
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
  opts: RunSpecOptions = {},
): Promise<RunSpecResult> {
  const steps = await planTask(db, deps.decomposer, taskId, spec);

  // learning: bias the candidate pool by past success before routing.
  const pool = opts.priors ? applyPriors(candidates, opts.priors) : candidates;

  let assigned = 0;
  const unrouted: string[] = [];
  for (const step of steps) {
    const choice = chooseRoute({ capability: step.agent ?? undefined }, pool);
    if (choice) {
      assignStep(db, step.id, choice.profile, choice.model);
      assigned += 1;
    } else {
      unrouted.push(step.id);
    }
  }

  // security: run in an isolated worktree when requested.
  let cwd: string | undefined;
  if (opts.sandbox) {
    cwd = prepareWorktree(opts.sandbox.repoRoot, taskId, {
      base: opts.sandbox.base,
      git: opts.sandbox.git,
    }).path;
  }

  updateStageStatus(db, taskId, "impl", "active");
  const exec = await executeImplStage(db, deps.executor, taskId, ids, cwd, opts.emit);

  return { steps: getSteps(db, taskId).length, assigned, unrouted, exec, cwd };
}
