// Learning — derive routing priors from run history and bias the router toward
// profiles that have actually succeeded. Deliberately simple (success-rate
// heuristics, not RL): a profile's effective cost is penalized in proportion to
// its failure rate, so the router's "cheapest" pick favors reliable + cheap.

import type { RouteCandidate } from "../automation/router.js";

export interface RunOutcome {
  profile: string;
  model?: string;
  success: boolean;
}

export interface Prior {
  success: number;
  total: number;
  rate: number; // success / total
}

export function priorKey(profile: string, model?: string): string {
  return model ? `${profile}|${model}` : profile;
}

/** Aggregate run outcomes into per-profile (and per-profile|model) priors. */
export function computePriors(outcomes: RunOutcome[]): Map<string, Prior> {
  const acc = new Map<string, { success: number; total: number }>();
  const bump = (key: string, ok: boolean) => {
    const a = acc.get(key) ?? { success: 0, total: 0 };
    a.total += 1;
    if (ok) a.success += 1;
    acc.set(key, a);
  };
  for (const o of outcomes) {
    bump(priorKey(o.profile), o.success);
    if (o.model) bump(priorKey(o.profile, o.model), o.success);
  }
  const out = new Map<string, Prior>();
  for (const [k, a] of acc) out.set(k, { success: a.success, total: a.total, rate: a.success / a.total });
  return out;
}

export interface ApplyPriorsOptions {
  /** Minimum runs before a prior influences cost (avoids over-reacting to one
   *  data point). Default 2. */
  minRuns?: number;
}

/**
 * Re-score candidates by their prior: a profile (prefer profile|model when
 * known) with a low success rate gets its effective costPerUnit inflated, so
 * the router's cheapest-pick avoids unreliable agents. Unknown / too-few-runs
 * priors leave cost unchanged.
 */
export function applyPriors(
  candidates: RouteCandidate[],
  priors: Map<string, Prior>,
  opts: ApplyPriorsOptions = {},
): RouteCandidate[] {
  const minRuns = opts.minRuns ?? 2;
  return candidates.map((c) => {
    const prior = (c.model && priors.get(priorKey(c.profile, c.model))) || priors.get(priorKey(c.profile));
    if (!prior || prior.total < minRuns) return c;
    const base = c.costPerUnit ?? 1;
    // failure rate scales cost: rate 1.0 → ×1, rate 0.5 → ×1.5, rate 0 → ×2.
    const factor = 1 + (1 - prior.rate);
    return { ...c, costPerUnit: base * factor };
  });
}
