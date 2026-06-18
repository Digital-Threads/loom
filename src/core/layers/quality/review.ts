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

/** Prompt for a review pass — the skill drives the lens; JSON findings out. */
export function reviewPrompt(passKey: string, target: string): string {
  return [
    `Review the work using the "${passKey}" lens.`,
    'Return ONLY a JSON array of findings: [{ "severity": "bug|warn|info", "message": "...", "file": "..."? }].',
    "Empty array if nothing. No prose.",
    "",
    "TARGET:",
    target,
  ].join("\n");
}

/** Parse a review agent's JSON output into Findings (defensive; bad → []). */
export function parseFindings(passKey: string, text: string): Finding[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Finding[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Record<string, unknown>;
    const sev = f.severity;
    if (sev !== "bug" && sev !== "warn" && sev !== "info") continue;
    if (typeof f.message !== "string") continue;
    out.push({ pass: passKey, severity: sev, message: f.message, file: typeof f.file === "string" ? f.file : undefined });
  }
  return out;
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
 * Aggregate a flat list of findings into a verdict: dedupe, sort by severity,
 * count per severity, fail if any `bug` remains. Shared by single-shot reviews
 * and the multi-reviewer pipeline (which accumulates findings across reviewers
 * and re-aggregates after each step).
 */
export function aggregateFindings(findings: Finding[]): ReviewResult {
  const deduped = dedupeFindings(findings).sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const counts: Record<Severity, number> = { bug: 0, warn: 0, info: 0 };
  for (const f of deduped) counts[f.severity] += 1;
  return { findings: deduped, counts, passed: counts.bug === 0 };
}

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
  return aggregateFindings(all);
}
