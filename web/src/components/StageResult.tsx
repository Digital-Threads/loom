import { useEffect, useState } from "react";
import type { LoomClient, ReviewResult, QaResult } from "../api";

const REVIEWER_ORDER = ["self", "ralph", "adversarial"] as const;
const REVIEWER_LABELS: Record<string, string> = { self: "Своё ревью", ralph: "Ralph-loop", adversarial: "Adversarial" };

// Structured result card for the review / qa stages — the findings table and
// check pass/fail list, shown above the transcript so the outcome is scannable
// (the transcript still carries the human-readable summary turn).
export function StageResult({
  client,
  taskId,
  stage,
  reloadKey,
  onFix,
}: {
  client: LoomClient;
  taskId: string;
  stage: string;
  reloadKey: number;
  onFix: () => void;
}) {
  const [review, setReview] = useState<{ result: ReviewResult | null; action?: string; reviewersDone?: string[] } | null>(null);
  const [qa, setQa] = useState<QaResult | null>(null);

  useEffect(() => {
    setReview(null);
    setQa(null);
    if (stage === "review") client.reviewGet(taskId).then(setReview).catch(() => {});
    else if (stage === "qa") client.qaGet(taskId).then(setQa).catch(() => {});
  }, [client, taskId, stage, reloadKey]);

  if (stage === "review" && review?.result) {
    const r = review.result;
    const done = review.reviewersDone ?? [];
    const allReviewersRan = REVIEWER_ORDER.every((k) => done.includes(k));
    return (
      <div className="result-card">
        <div className="result-head">
          <span className={`badge ${r.passed ? "badge-ok" : "badge-warn"}`}>{r.passed ? "passed" : "blockers"}</span>
          <span className="result-counts">{r.counts.bug ?? 0} bug · {r.counts.warn ?? 0} warn · {r.counts.info ?? 0} info</span>
          {review.action ? <span className="chip">{review.action}</span> : null}
          {REVIEWER_ORDER.map((k) => (
            <span key={k} className={`chip ${done.includes(k) ? "" : "badge-dim"}`} title={done.includes(k) ? "ran" : "pending"}>
              {done.includes(k) ? "✓ " : "○ "}{REVIEWER_LABELS[k]}
            </span>
          ))}
          {/* Fix once at the end — only after all three reviewers have run. */}
          {allReviewersRan && r.findings.length ? <button className="btn acc sm" style={{ marginLeft: "auto" }} onClick={onFix}>🔧 Fix all findings</button> : null}
        </div>
        {r.findings.length ? (
          <ul className="finding-list">
            {r.findings.map((f, i) => (
              <li key={i} className={`finding sev-${f.severity}`}>
                <span className="finding-sev">{f.severity}</span>
                <span className="finding-msg">
                  {f.file ? <code className="finding-file">{f.file}</code> : null}
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted" style={{ padding: "4px 2px" }}>No findings.</div>
        )}
      </div>
    );
  }

  if (stage === "qa" && qa) {
    return (
      <div className="result-card">
        <div className="result-head">
          <span className={`badge ${qa.passed ? "badge-ok" : "badge-warn"}`}>{qa.passed ? "all green" : "failures"}</span>
          <span className="result-counts">{qa.results.filter((c) => c.ok).length}/{qa.results.length} checks</span>
        </div>
        <ul className="finding-list">
          {qa.results.map((c, i) => (
            <li key={i} className={`finding ${c.ok ? "sev-info" : "sev-bug"}`}>
              <span className="finding-sev">{c.ok ? "✓" : "✗"}</span>
              <span className="finding-msg"><code className="finding-file">{c.key}</code>{c.output ? c.output.split("\n")[0] : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}
