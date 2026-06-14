// L6.4 — QA runner: always tests+build; web adds a browser scenario (canary).
// Each check is injected (a command in the sandbox, or a canary run) so the
// runner is testable. A failing check → passed=false (caller queues attention).
export interface QaCheck {
  key: string; // tests | build | browser | custom:<skill>
  run(): Promise<{ ok: boolean; output?: string }>;
}

export interface QaCheckResult {
  key: string;
  ok: boolean;
  output?: string;
}

export interface QaResult {
  passed: boolean;
  results: QaCheckResult[];
}

/** Run QA checks in order; a throwing check is a failure, not an abort. */
export async function runQa(checks: QaCheck[]): Promise<QaResult> {
  const results: QaCheckResult[] = [];
  for (const c of checks) {
    try {
      const r = await c.run();
      results.push({ key: c.key, ok: r.ok, output: r.output });
    } catch (e) {
      results.push({ key: c.key, ok: false, output: (e as Error).message });
    }
  }
  return { passed: results.every((r) => r.ok), results };
}
