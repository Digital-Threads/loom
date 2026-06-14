// L5 — swarm step: fan out N attempts of a step (different perspectives), then
// aggregate into one result. Built on the v1 coordinator (runConcurrent +
// majorityVote). The attempt fn is injected — in the engine it spawns a
// sub-agent session (run-manager child run, parentRunId); here it's any async.
import { runConcurrent, majorityVote, successes, type SwarmTask, type SwarmOutcome, type Consensus } from "./coordinator.js";

export interface SwarmConfig {
  /** How many parallel attempts. */
  attempts: number;
  /** Max in flight (default: all). */
  concurrency?: number;
  /** Optional per-attempt perspectives/lenses (index-aligned). */
  perspectives?: string[];
}

export const SWARM_DEFAULT: SwarmConfig = { attempts: 3 };

export interface SwarmStepResult<T> {
  /** Synthesised/elected result (undefined if every attempt failed). */
  value?: T;
  consensus: Consensus<T>;
  outcomes: SwarmOutcome<T>[];
}

/**
 * Run a step as a swarm: N attempts in parallel → collect successes → synthesise.
 * Default synthesis is majority vote; pass `synthesize` to merge/select instead
 * (the coordinator-agent's fan-in). Never throws (failures captured per attempt).
 */
export async function runSwarmStep<T>(
  cfg: SwarmConfig,
  attempt: (index: number, perspective?: string) => Promise<T>,
  synthesize?: (values: T[]) => T,
): Promise<SwarmStepResult<T>> {
  const n = Math.max(1, cfg.attempts);
  const tasks: SwarmTask<T>[] = Array.from({ length: n }, (_, i) => ({
    id: `attempt-${i}`,
    run: () => attempt(i, cfg.perspectives?.[i]),
  }));
  const outcomes = await runConcurrent(tasks, cfg.concurrency ?? n);
  const values = successes(outcomes);
  const consensus = majorityVote(values);
  const value = values.length === 0 ? undefined : synthesize ? synthesize(values) : consensus.winner;
  return { value, consensus, outcomes };
}
