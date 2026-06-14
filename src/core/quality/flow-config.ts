// L6.1 — flow-config resolver: which passes run at a slot-stage (Review/QA, and
// reused by swarm L5). Global per-column default + per-task override; the
// per-task choice wins (Bible §3). Pure — storage (Settings) lands in D6.
export interface FlowConfig {
  /** Ordered pass keys: normal | simplify | adversarial | ralph | tests | build |
   *  browser | custom:<skill>. */
  passes: string[];
}

/** Built-in defaults when neither column nor task configures a stage. */
export const FLOW_DEFAULTS: Record<string, string[]> = {
  review: ["normal", "simplify"],
  qa: ["tests", "build"],
};

/**
 * Resolve the effective pass list for a stage. Priority: a non-empty per-task
 * override wins; else the column default; else the built-in default; else [].
 */
export function resolveFlow(
  stage: string,
  columnDefault?: FlowConfig,
  taskOverride?: FlowConfig,
): string[] {
  if (taskOverride?.passes && taskOverride.passes.length > 0) return taskOverride.passes;
  if (columnDefault?.passes && columnDefault.passes.length > 0) return columnDefault.passes;
  return FLOW_DEFAULTS[stage] ?? [];
}
