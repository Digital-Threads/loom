// L5 swarm — impl-as-swarm: run N candidate implementations in parallel, each in
// its own worktree (see prepareSwarmWorktree), gate each on the objective QA
// checks, and have a judge elect ONE winner among the candidates that passed.
// The losers' worktrees are cleaned up by the caller. This is the engine only —
// the real implement/qaGate/judge are injected, so it's testable without agents
// or git, and the api wiring supplies the live versions.

import { runConcurrent } from "./coordinator.js";

export interface ImplAttempt {
  slot: number;
  branch: string;
  /** The impl agent's final output for this attempt. */
  output: string;
  /** Did this attempt pass the objective QA checks (tests/build)? */
  green: boolean;
  /** Short QA summary (which checks passed/failed). */
  qa: string;
}

export interface ImplSwarmResult {
  /** The elected attempt, or null when none passed QA (caller falls back). */
  winner: ImplAttempt | null;
  /** Every attempt that produced a result (failed-to-implement ones are dropped). */
  attempts: ImplAttempt[];
  /** Why this winner (or why none). */
  rationale: string;
}

export interface ImplSwarmDeps {
  attempts: number;
  /** Per-attempt lenses (index-aligned); undefined when fewer than attempts. */
  perspectives: string[];
  /** Build candidate `slot`: prepare its worktree, run the impl agent (with the
   *  perspective), commit, and return the branch + the agent's output. */
  implement: (slot: number, perspective: string | undefined) => Promise<{ branch: string; output: string }>;
  /** Run the objective QA checks in attempt `slot`'s worktree. */
  qaGate: (slot: number, branch: string) => Promise<{ green: boolean; summary: string }>;
  /** Elect ONE winner among the candidates that passed QA. Only called with ≥2
   *  greens — the engine short-circuits 0 and 1. */
  judge: (greens: ImplAttempt[]) => Promise<{ winnerSlot: number; rationale: string }>;
  /** Max attempts in flight (default: all at once). */
  concurrency?: number;
}

/** Run the impl-swarm: fan out N (implement → QA) candidates, then elect among the
 *  green ones. Never rejects — an attempt that throws is dropped (so a partial
 *  failure still elects from the survivors). 0 greens → winner null. */
export async function runImplSwarm(deps: ImplSwarmDeps): Promise<ImplSwarmResult> {
  const n = Math.max(1, deps.attempts);
  const tasks = Array.from({ length: n }, (_, slot) => ({
    id: `sw${slot}`,
    run: async (): Promise<ImplAttempt> => {
      const { branch, output } = await deps.implement(slot, deps.perspectives[slot]);
      const qa = await deps.qaGate(slot, branch);
      return { slot, branch, output, green: qa.green, qa: qa.summary };
    },
  }));
  const outcomes = await runConcurrent(tasks, deps.concurrency ?? n);
  const attempts = outcomes.filter((o) => o.value !== undefined).map((o) => o.value as ImplAttempt);
  const greens = attempts.filter((a) => a.green);

  if (greens.length === 0) return { winner: null, attempts, rationale: "no candidate passed QA" };
  if (greens.length === 1) return { winner: greens[0], attempts, rationale: "only one candidate passed QA" };

  const { winnerSlot, rationale } = await deps.judge(greens);
  const winner = greens.find((g) => g.slot === winnerSlot) ?? greens[0];
  return { winner, attempts, rationale };
}
