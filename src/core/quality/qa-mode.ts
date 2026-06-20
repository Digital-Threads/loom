// QA depth. "minimal" runs only the objective checks (tests/build) — the floor.
// "full" adds an agent verification pass on top (the verification-before-completion
// skill + browser qa-skills when the task is a reachable web app). Resolved from a
// global default plus an optional per-task override, so a user can opt a single
// task into deep QA without changing the default. Pure → testable without the store.

export type QaMode = "minimal" | "full";

/** Per-task override values a task may carry. "inherit" defers to the global default. */
export type QaModeOverride = QaMode | "inherit";

function asMode(v: unknown): QaMode | "inherit" | undefined {
  return v === "full" || v === "minimal" || v === "inherit" ? v : undefined;
}

/** Resolve the effective QA mode: a per-task "minimal"/"full" wins; "inherit" or an
 *  absent/garbage override falls back to the global default (itself "minimal" unless
 *  set to "full"). */
export function resolveQaMode(globalDefault: unknown, perTask: unknown): QaMode {
  const t = asMode(perTask);
  if (t === "full" || t === "minimal") return t;
  return asMode(globalDefault) === "full" ? "full" : "minimal";
}
