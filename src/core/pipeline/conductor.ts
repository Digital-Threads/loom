// L13 — the cross-stage conductor: the code engine that drives a task through
// its route per run_mode, invoking each stage's runner and honouring gates.
// Stage runners (analysis/brainstorm/spec → L12, rd/impl → L4, review/qa → L6,
// pr/done → L14) are registered in a map; the conductor is pure orchestration
// over the pipeline engine (currentStage/completeStage) — no LLM (variant A).
import type Database from "better-sqlite3";
import { currentStage, completeStage } from "./engine.js";
import { getStages, getTask, setStageGate } from "../store/db.js";

export interface StageOutcome {
  ok: boolean;
  /** Park for a human even on ok (e.g. review found issues to triage). */
  needsAttention?: boolean;
  note?: string;
}

export type StageRunner = (db: Database.Database, taskId: string, stageKey: string) => Promise<StageOutcome>;
export type RunnerRegistry = Record<string, StageRunner>;

/** Run one stage: invoke its runner (absent = pass-through), and on a clean
 *  outcome complete it + activate the next. Returns the outcome + new current. */
export async function runStage(
  db: Database.Database,
  taskId: string,
  stageKey: string,
  runners: RunnerRegistry,
): Promise<{ outcome: StageOutcome; next: string | null }> {
  const runner = runners[stageKey];
  const outcome: StageOutcome = runner ? await runner(db, taskId, stageKey) : { ok: true };
  if (outcome.ok && !outcome.needsAttention) {
    return { outcome, next: completeStage(db, taskId, stageKey) };
  }
  return { outcome, next: stageKey }; // parked at the current stage
}

export interface AdvanceResult {
  /** Stages that ran this advance. */
  ran: string[];
  /** Where the task parked (null = reached done). */
  stoppedAt: string | null;
  /** Why it stopped, when notable (e.g. the cost cap tripped). */
  reason?: { kind: string; cap?: number; spent?: number; resetsAt?: string | null; profile?: string | null };
}

export interface AdvanceOptions {
  /** Stop before starting another stage once spend reaches this many USD
   *  (0/undefined = no cap). Guards autopilot against runaway cost. */
  costCapUsd?: number;
  /** Current total USD spent on the task (injected; reads the cost rows). */
  spentUsd?: (taskId: string) => number;
  /** Did the stage that just ran hit the provider rate limit? Injected (reads
   *  the stage's stop-reason). When it returns info, the loop stops instead of
   *  firing the next stage into an exhausted profile. */
  rateLimited?: (taskId: string, stageKey: string) => { resetsAt?: string | null; profile?: string | null } | null;
}

/**
 * Drive the task per its run_mode:
 *  - manual    — never auto-runs; parks at the current stage (UI runs each).
 *  - gated     — auto-runs gate=0 stages, parks at the first gate=1 (approval).
 *  - autopilot — runs through, ignoring gates (sandbox only), until done/fail.
 * Stops on the first failed/needs-attention stage.
 */
export async function advanceTask(
  db: Database.Database,
  taskId: string,
  runners: RunnerRegistry,
  opts: AdvanceOptions = {},
): Promise<AdvanceResult> {
  const task = getTask(db, taskId);
  const ran: string[] = [];
  if (!task) return { ran, stoppedAt: null };
  const mode = task.run_mode;

  for (;;) {
    const cur = currentStage(getStages(db, taskId));
    if (!cur) return { ran, stoppedAt: null };
    if (mode === "manual") return { ran, stoppedAt: cur.stage_key };
    if (mode === "gated" && cur.gate === 1) return { ran, stoppedAt: cur.stage_key };

    // Cost cap: stop before starting another (expensive) stage when over budget.
    if (opts.costCapUsd && opts.spentUsd) {
      const spent = opts.spentUsd(taskId);
      if (spent >= opts.costCapUsd) {
        return { ran, stoppedAt: cur.stage_key, reason: { kind: "cost_cap", cap: opts.costCapUsd, spent } };
      }
    }

    const { outcome, next } = await runStage(db, taskId, cur.stage_key, runners);
    ran.push(cur.stage_key);
    if (!outcome.ok || outcome.needsAttention) return { ran, stoppedAt: cur.stage_key };
    // Rate limit: the stage's session hit the provider limit. Stop before firing
    // the next stage into the exhausted profile (it would only produce garbage).
    const rl = opts.rateLimited?.(taskId, cur.stage_key);
    if (rl) return { ran, stoppedAt: cur.stage_key, reason: { kind: "rate_limit", ...rl } };
    if (next === null) return { ran, stoppedAt: null };
  }
}

/** Run the current stage regardless of its gate (manual Run / gate approval),
 *  then continue advancing per run_mode. */
export async function runAndAdvance(
  db: Database.Database,
  taskId: string,
  runners: RunnerRegistry,
  opts: AdvanceOptions = {},
): Promise<AdvanceResult> {
  const cur = currentStage(getStages(db, taskId));
  if (!cur) return { ran: [], stoppedAt: null };
  const { outcome, next } = await runStage(db, taskId, cur.stage_key, runners);
  const ran = [cur.stage_key];
  if (!outcome.ok || outcome.needsAttention || next === cur.stage_key) {
    return { ran, stoppedAt: cur.stage_key };
  }
  const rest = await advanceTask(db, taskId, runners, opts);
  return { ran: [...ran, ...rest.ran], stoppedAt: rest.stoppedAt, reason: rest.reason };
}

/** Toggle a stage gate on the fly. */
export function setGate(db: Database.Database, taskId: string, stageKey: string, on: boolean): void {
  setStageGate(db, taskId, stageKey, on);
}
