// Real Decomposer: asks an aimux agent (a cheap/fast profile) to turn a spec
// into a JSON step DAG, then parses it via parsePlan. Launch + config + profile
// selection are injectable so planning is testable without spawning a CLI.

import { loadConfig, runProfileHeadless } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import { planPrompt, parsePlan, type Decomposer, type StepSpec } from "./planner.js";

export interface AimuxDecomposerDeps {
  launch?: typeof runProfileHeadless;
  loadConfig?: typeof loadConfig;
  /** Configured cheap planner profile id. */
  plannerProfile?: string;
  /** Cheap model override for the planning call. */
  plannerModel?: string;
  /** Fallback profile chooser when plannerProfile is unset (default: first sub). */
  pickProfile?: () => string | undefined;
}

export function createAimuxDecomposer(deps: AimuxDecomposerDeps = {}): Decomposer {
  const launch = deps.launch ?? runProfileHeadless;
  const load = deps.loadConfig ?? loadConfig;
  const pickProfile = deps.pickProfile ?? (() => listSubscriptions()[0]?.name);

  return {
    async decompose(spec: string): Promise<StepSpec[]> {
      const cfg = load();
      if (!cfg) return [];
      const profile = deps.plannerProfile ?? pickProfile();
      if (!profile) return [];
      const res = await launch(cfg, profile, {
        model: deps.plannerModel,
        extraArgs: ["-p", planPrompt(spec)],
      });
      return parsePlan(res.stdout ?? "");
    },
  };
}
