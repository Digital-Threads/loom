import { useState } from "react";
import type { LoomClient, ReviewResult, QaResult } from "../api";

// L6.6 — Review / QA panels: run the configured passes/checks and show the
// verdict + findings/results.
export function ReviewQA({ client, taskId, stage }: { client: LoomClient; taskId: string; stage: string }) {
  const [review, setReview] = useState<{ result: ReviewResult; action: string } | null>(null);
  const [qa, setQa] = useState<QaResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (stage === "review") setReview(await client.reviewRun(taskId));
      else setQa(await client.qaRun(taskId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn acc" disabled={busy} onClick={run}>▶ Run {stage}</button>

      {stage === "review" && review ? (
        <>
          <div className="kv" style={{ marginTop: 12 }}>
            <b>{review.result.passed ? "✓ passed" : "✗ failed"}</b>
            <span>action: {review.action} · bug {review.result.counts.bug ?? 0} · warn {review.result.counts.warn ?? 0}</span>
          </div>
          {review.result.findings.map((fnd, i) => (
            <div className={`kv ${fnd.severity === "bug" ? "warn" : ""}`} key={i}>
              <b>{fnd.severity}</b><span>{fnd.pass}: {fnd.message}{fnd.file ? ` (${fnd.file})` : ""}</span>
            </div>
          ))}
        </>
      ) : null}

      {stage === "qa" && qa ? (
        <>
          <div className="kv" style={{ marginTop: 12 }}><b>{qa.passed ? "✓ passed" : "✗ failed"}</b><span>{qa.results.length} check(s)</span></div>
          {qa.results.map((r, i) => (
            <div className={`kv ${r.ok ? "" : "warn"}`} key={i}><b>{r.key}</b><span>{r.ok ? "ok" : `fail${r.output ? `: ${r.output}` : ""}`}</span></div>
          ))}
          {qa.results.length === 0 ? <div className="muted">No QA checks configured (set commands in Settings).</div> : null}
        </>
      ) : null}
    </div>
  );
}
