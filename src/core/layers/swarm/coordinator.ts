// Swarm — coordinate multiple agents: bounded-concurrency fan-out + simple
// consensus over their outputs. The heavy multi-agent runtime (topologies,
// queens, BFT) is deliberately out of scope; this is the v1 coordinator:
// run N attempts in parallel with a cap, then pick by majority.

export interface SwarmTask<T> {
  id: string;
  run(): Promise<T>;
}

export interface SwarmOutcome<T> {
  id: string;
  value?: T;
  error?: string;
}

/**
 * Run tasks with at most `concurrency` in flight at once. Never rejects — a
 * task that throws is captured as { error } in its slot. Results preserve input
 * order.
 */
export async function runConcurrent<T>(
  tasks: SwarmTask<T>[],
  concurrency: number,
): Promise<SwarmOutcome<T>[]> {
  const limit = Math.max(1, concurrency);
  const results: SwarmOutcome<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      const t = tasks[i];
      try {
        results[i] = { id: t.id, value: await t.run() };
      } catch (e) {
        results[i] = { id: t.id, error: (e as Error).message };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

export interface Consensus<T> {
  winner?: T;
  count: number;
  total: number;
  /** count / total; 0 when no values. */
  ratio: number;
}

/**
 * Majority consensus over values. `keyOf` groups equivalent values (default:
 * JSON). Returns the most common value, its count, and the agreement ratio.
 */
export function majorityVote<T>(values: T[], keyOf: (v: T) => string = (v) => JSON.stringify(v)): Consensus<T> {
  if (values.length === 0) return { count: 0, total: 0, ratio: 0 };
  const groups = new Map<string, { value: T; count: number }>();
  for (const v of values) {
    const k = keyOf(v);
    const g = groups.get(k);
    if (g) g.count += 1;
    else groups.set(k, { value: v, count: 1 });
  }
  let best = { value: values[0], count: 0 };
  for (const g of groups.values()) if (g.count > best.count) best = g;
  return { winner: best.value, count: best.count, total: values.length, ratio: best.count / values.length };
}

/** Collect the successful values out of swarm outcomes (drop errors). */
export function successes<T>(outcomes: SwarmOutcome<T>[]): T[] {
  return outcomes.filter((o) => o.error === undefined).map((o) => o.value as T);
}
