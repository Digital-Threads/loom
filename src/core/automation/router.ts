// Router — pick the agent/profile + model for a step. Policy: cheapest capable
// profile that still has quota. Inputs (candidates) come from aimux (profiles,
// quota) and token-pilot/pricing (cost); kept as plain data so the choice is
// pure and testable.

export interface RouteCandidate {
  profile: string;
  model?: string;
  /** Relative cost per unit of work — lower is cheaper. Unknown sorts last. */
  costPerUnit?: number;
  /** Remaining quota; 0/undefined-as-0 means exhausted (excluded). undefined = unknown (kept). */
  quotaRemaining?: number;
  /** Declared capabilities; absent = assume capable of anything. */
  capabilities?: string[];
}

export interface RouteNeed {
  /** Capability the step requires (e.g. "code", "browser"); optional. */
  capability?: string;
  /** Explicit model override that wins over the candidate's default. */
  model?: string;
}

export interface RouteChoice {
  profile: string;
  model?: string;
}

/**
 * Choose the cheapest capable profile with quota. Returns null when nothing is
 * eligible (caller queues the step). Quota: undefined = unknown (eligible),
 * a number <= 0 = exhausted (excluded). Capability: a candidate with no declared
 * capabilities is assumed capable.
 */
export function chooseRoute(
  need: RouteNeed,
  candidates: RouteCandidate[],
): RouteChoice | null {
  const eligible = candidates.filter((c) => {
    const hasQuota = c.quotaRemaining === undefined || c.quotaRemaining > 0;
    const capable =
      !need.capability || !c.capabilities || c.capabilities.includes(need.capability);
    return hasQuota && capable;
  });
  if (eligible.length === 0) return null;

  eligible.sort(
    (a, b) => (a.costPerUnit ?? Number.POSITIVE_INFINITY) - (b.costPerUnit ?? Number.POSITIVE_INFINITY),
  );
  const pick = eligible[0];
  return { profile: pick.profile, model: need.model ?? pick.model };
}
