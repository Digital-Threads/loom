// Real StepExecutor: runs a step's agent via aimux's headless launch, carrying
// the spine ids (task/workflow) into the session so token-pilot / task-journal
// telemetry ties back to the task. The launch + config loaders are injectable
// so the orchestration can be tested without spawning a real CLI.

import { loadConfig, runProfileHeadless } from "@digital-threads/aimux/core";
import type { StepExecutor, ExecRequest, ExecResult } from "./exec-loop.js";
import type { StepRow } from "../store/steps.js";

export interface AimuxExecutorDeps {
  launch?: typeof runProfileHeadless;
  loadConfig?: typeof loadConfig;
}

/** Build the prompt handed to the agent from the step's plan fields. */
export function buildPrompt(step: StepRow): string {
  const parts = [step.title];
  if (step.approach) parts.push(`\n\nApproach:\n${step.approach}`);
  if (step.files) {
    try {
      const files = JSON.parse(step.files);
      if (Array.isArray(files) && files.length) parts.push(`\n\nFiles: ${files.join(", ")}`);
    } catch {
      /* ignore malformed files json */
    }
  }
  return parts.join("");
}

export function createAimuxExecutor(deps: AimuxExecutorDeps = {}): StepExecutor {
  const launch = deps.launch ?? runProfileHeadless;
  const load = deps.loadConfig ?? loadConfig;

  return {
    async run(req: ExecRequest): Promise<ExecResult> {
      const cfg = load();
      if (!cfg) return { exitCode: 1, stderr: "aimux: no config" };

      const profile = req.step.profile ?? req.ids.profileId;
      if (!profile) return { exitCode: 1, stderr: "aimux: no profile for step" };

      const res = await launch(cfg, profile, {
        model: req.step.model ?? undefined,
        extraArgs: ["-p", buildPrompt(req.step)],
        taskId: req.ids.taskId,
        workflowId: req.ids.workflowId,
      });
      return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr };
    },
  };
}
