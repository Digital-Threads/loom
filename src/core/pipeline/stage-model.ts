// Per-stage model policy — explicit and deterministic, not guessed.
//
// The whole "cheap but good" strategy rests on the first stages being excellent:
// spend the strong model where the work is THINKING (analysis, spec, review) and
// a cheap model where it's mechanical (qa, pr, done). Each stage declares its tier
// with a rationale below; a per-task / per-column override or an escalation can
// raise it, but the default is a fixed, predictable policy.
//
// The model is bound when a session spawns and cannot change mid-session, so
// stages that share a tier share one session (continuity within a tier) and a
// tier change starts a fresh session, handed off through the artifacts (analysis
// note → spec → impl reads the spec). `modelLane` is that session key.

export type ModelTier = "opus" | "sonnet" | "haiku";

/** The tiers a user can pick by hand, strongest → cheapest. */
export const MODEL_TIERS: ModelTier[] = ["opus", "sonnet", "haiku"];

export const STAGE_MODEL: Record<string, ModelTier> = {
  analysis: "opus", // understand the task + choose the route — get this right
  brainstorm: "opus", // surface assumptions / questions
  spec: "opus", // write the spec the rest of the pipeline trusts
  rd: "sonnet", // decompose into steps
  impl: "sonnet", // write code (escalates to opus if it keeps bouncing back)
  review: "opus", // adversarial — catch what impl + a weak model missed
  qa: "haiku", // run checks, read output
  pr: "haiku", // write the PR text
  done: "haiku", // finalize
};

/** Default model when a stage is unknown — balanced, never the most expensive. */
export const DEFAULT_TIER: ModelTier = "sonnet";

/** Relocations (impl bounced back to analysis/spec) before impl is escalated to
 *  opus: a task that keeps failing implementation has proven it is hard. */
export const IMPL_ESCALATE_AFTER = 2;

export interface ResolveModelOpts {
  /** Explicit per-task / per-column model — wins over the map and escalation. */
  override?: string;
  /** How many times this task has been relocated — escalates a stubborn impl. */
  relocations?: number;
}

/**
 * Resolve the model for a stage. Priority: explicit override > escalation > map.
 * Returns a tier alias ("opus"/"sonnet"/"haiku") or the raw override string —
 * both are valid `--model` values that aimux passes through.
 */
export function resolveStageModel(stage: string, opts: ResolveModelOpts = {}): string {
  if (opts.override) return opts.override;
  if (stage === "impl" && (opts.relocations ?? 0) >= IMPL_ESCALATE_AFTER) return "opus";
  return STAGE_MODEL[stage] ?? DEFAULT_TIER;
}

/**
 * The session "lane" for a stage: stages resolving to the same model share a
 * session; a different model starts a new one. Keyed by the resolved model so an
 * override or escalation correctly forks a new lane.
 */
export function modelLane(stage: string, opts: ResolveModelOpts = {}): string {
  return resolveStageModel(stage, opts);
}
