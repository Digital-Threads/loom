// Quality — run a configurable set of review passes over the work and aggregate
// their findings into a single verdict. Each pass (standard review, simplify,
// adversarial, Ralph Loop, security scan…) is a skill run, injected so the
// aggregation is testable without invoking real reviewers.

export type Severity = "bug" | "warn" | "info";

export interface Finding {
  pass: string;
  severity: Severity;
  message: string;
  file?: string;
}

export interface ReviewPass {
  key: string;
  run(): Promise<Finding[]>;
}

/** Dedupe by severity+file+message (the same issue found by two passes). */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const k = `${f.severity}|${f.file ?? ""}|${f.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

export interface ReviewResult {
  findings: Finding[];
  counts: Record<Severity, number>;
  /** false when any `bug`-severity finding remains. */
  passed: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { bug: 0, warn: 1, info: 2 };

/**
 * Run review passes in order, collect+dedupe findings, and compute the verdict.
 * A failing pass (its run() throws) becomes a `warn` finding rather than
 * aborting the whole review.
 */
export async function runReviewPasses(passes: ReviewPass[]): Promise<ReviewResult> {
  const all: Finding[] = [];
  for (const pass of passes) {
    try {
      all.push(...(await pass.run()));
    } catch (e) {
      all.push({ pass: pass.key, severity: "warn", message: `pass failed: ${(e as Error).message}` });
    }
  }

  const findings = dedupeFindings(all).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const counts: Record<Severity, number> = { bug: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;

  return { findings, counts, passed: counts.bug === 0 };
}
