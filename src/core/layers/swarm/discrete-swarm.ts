// L5 swarm — discrete (read-only) swarm for stages that don't mutate code, e.g.
// review and analysis: run N independent attempts of the SAME stage, each with a
// distinct perspective, then synthesize. "Discrete" = every attempt shares one
// read-only view (no per-attempt worktree); only the verdict/findings differ.
// The synthesis itself (union findings for review, majority vote for analysis)
// lives with the caller that owns those types — this module just fans out.

import { runConcurrent, successes } from "./coordinator.js";
import type { StageSwarmConfig } from "./config.js";

/** One attempt: the index and its perspective (may be undefined when fewer
 *  perspectives than attempts are configured). Returns the agent's raw output. */
export type SwarmAttempt = (index: number, perspective: string | undefined) => Promise<string>;

export interface DiscreteSwarmResult {
  /** Raw outputs of the attempts that succeeded, in attempt order. */
  outputs: string[];
  /** Attempts launched (= cfg.attempts). */
  attempts: number;
  /** Attempts that produced an output (the rest threw / were dropped). */
  survivors: number;
}

/** Append the attempt's perspective lens to the base stage prompt, so each
 *  attempt looks at the work through a different angle. No perspective → base. */
export function perspectivePrompt(base: string, perspective: string | undefined): string {
  const p = perspective?.trim();
  return p ? `${base}\n\nFocus this pass through the "${p}" lens.` : base;
}

/** Fan out cfg.attempts copies of a discrete stage (bounded concurrency), each
 *  with its index-aligned perspective. Never rejects — a failed attempt is just
 *  dropped (captured by runConcurrent), so a partial failure still yields the
 *  survivors for synthesis. The caller decides what to do with zero survivors
 *  (typically fall back to a single normal run). */
export async function runDiscreteSwarm(
  cfg: StageSwarmConfig,
  attempt: SwarmAttempt,
  concurrency: number = cfg.attempts,
): Promise<DiscreteSwarmResult> {
  const n = Math.max(1, cfg.attempts);
  const tasks = Array.from({ length: n }, (_, i) => ({
    id: `attempt-${i}`,
    run: () => attempt(i, cfg.perspectives[i]),
  }));
  const outputs = successes(await runConcurrent(tasks, concurrency));
  return { outputs, attempts: n, survivors: outputs.length };
}
