// Default StageAgent for the dialog stages — a one-shot aimux headless call on a
// cheap profile. Injectable bits (config/launch/profile) keep it testable; with
// no config/profile it returns "" so the stage degrades gracefully.
import { loadConfig, runProfileHeadless } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import { enforceFlags } from "../automation/enforced-settings.js";
import type { StageAgent } from "./stage-runners.js";

export interface StageAgentDeps {
  launch?: typeof runProfileHeadless;
  loadConfig?: typeof loadConfig;
  profile?: string;
  model?: string;
  /** Reasoning effort (→ claude `--effort`), e.g. "xhigh" for an ultracode task. */
  effort?: string;
}

export function createAimuxStageAgent(deps: StageAgentDeps = {}): StageAgent {
  const launch = deps.launch ?? runProfileHeadless;
  const load = deps.loadConfig ?? loadConfig;
  return async (prompt: string) => {
    const cfg = load();
    if (!cfg) return "";
    const profile = deps.profile ?? listSubscriptions()[0]?.name;
    if (!profile) return "";
    // Force token-pilot's hooks into this headless session too — without these
    // the stage (and the skill-generation path) would run on raw reads.
    const effortArgs = deps.effort ? ["--effort", deps.effort] : [];
    const res = await launch(cfg, profile, { model: deps.model, extraArgs: ["-p", prompt, ...enforceFlags(), ...effortArgs] });
    return res.stdout ?? "";
  };
}
