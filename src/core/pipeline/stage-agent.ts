// Default StageAgent for the dialog stages — a one-shot aimux headless call on a
// cheap profile. Injectable bits (config/launch/profile) keep it testable; with
// no config/profile it returns "" so the stage degrades gracefully.
import { loadConfig, runProfileHeadless } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import type { StageAgent } from "./stage-runners.js";

export interface StageAgentDeps {
  launch?: typeof runProfileHeadless;
  loadConfig?: typeof loadConfig;
  profile?: string;
  model?: string;
}

export function createAimuxStageAgent(deps: StageAgentDeps = {}): StageAgent {
  const launch = deps.launch ?? runProfileHeadless;
  const load = deps.loadConfig ?? loadConfig;
  return async (prompt: string) => {
    const cfg = load();
    if (!cfg) return "";
    const profile = deps.profile ?? listSubscriptions()[0]?.name;
    if (!profile) return "";
    const res = await launch(cfg, profile, { model: deps.model, extraArgs: ["-p", prompt] });
    return res.stdout ?? "";
  };
}
