import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// Quality module — @digital-threads/loom-quality. The review pipeline and the QA
// checks are both editable (toggle / reorder), persisted via flow-config:
// flow.review for reviewers, flow.qa for QA checks.
const QA_OPTIONS = [
  { key: "tests", label: "tests", desc: "repo test script" },
  { key: "build", label: "build", desc: "repo build script" },
];
const REVIEWERS = [
  { key: "self", label: "Self review", desc: "The task session reviews its own changes." },
  { key: "ralph", label: "Ralph-loop", desc: "Iterative review, up to 3 passes." },
  { key: "adversarial", label: "Adversarial", desc: "/adversarial-review — tries to break the solution." },
];

export function Quality({ client }: { client: LoomClient }) {
  const [qa, setQa] = useState<string[] | null>(null);
  const [reviewers, setReviewers] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rBusy, setRBusy] = useState(false);
  useEffect(() => {
    client.flowConfig("qa").then(setQa).catch((e) => setErr(String(e)));
    client.flowConfig("review").then(setReviewers).catch((e) => setErr(String(e)));
  }, [client]);

  function toggle(key: string) {
    if (!qa) return;
    const next = qa.includes(key) ? qa.filter((k) => k !== key) : [...qa, key];
    setQa(next);
    setBusy(true);
    client.saveFlowConfig("qa", next).then(() => toast.success("QA saved")).catch((e) => toast.error(`Couldn't save: ${e}`)).finally(() => setBusy(false));
  }

  function saveReviewers(next: string[]) {
    setReviewers(next);
    setRBusy(true);
    client.saveFlowConfig("review", next)
      // Re-sync from the server so the UI reflects the resolved truth: empty →
      // default (all enabled), and any deduped/invalid keys are normalised.
      .then(() => { toast.success("Reviewers saved"); return client.flowConfig("review").then(setReviewers); })
      .catch((e) => toast.error(`Couldn't save: ${e}`)).finally(() => setRBusy(false));
  }
  function toggleReviewer(key: string) {
    if (!reviewers) return;
    saveReviewers(reviewers.includes(key) ? reviewers.filter((k) => k !== key) : [...reviewers, key]);
  }
  function moveReviewer(key: string, dir: -1 | 1) {
    if (!reviewers) return;
    const i = reviewers.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= reviewers.length) return;
    const next = [...reviewers];
    [next[i], next[j]] = [next[j], next[i]];
    saveReviewers(next);
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        AI code review + quality checks. Standalone package <code>@digital-threads/loom-quality</code>.
      </p>

      <h2>Review pipeline <span className="muted" style={{ fontSize: "var(--fs-xs)", fontWeight: 400 }}>(toggle &amp; reorder; findings accumulate → one fix)</span></h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "var(--fs-xs)" }}>
        Applies to features and bugs. A task the analysis classifies as a <strong>chore</strong> (a trivial change)
        runs only the first reviewer, to keep cost proportional — the rest are skipped for that task.
      </p>
      {!reviewers ? <StateView kind="loading" /> : (
        <ul className="finding-list">
          {[...reviewers.map((k) => REVIEWERS.find((r) => r.key === k)).filter(Boolean) as typeof REVIEWERS,
            ...REVIEWERS.filter((r) => !reviewers.includes(r.key))].map((r) => {
            const on = reviewers.includes(r.key);
            const idx = reviewers.indexOf(r.key);
            return (
              <li key={r.key} className={`finding ${on ? "sev-info" : ""}`}>
                <button className={`btn sm ${on ? "acc" : ""}`} disabled={rBusy} title={on ? "Disable" : "Enable"} onClick={() => toggleReviewer(r.key)}>
                  {on ? "✓" : "○"}
                </button>
                {on && (
                  <span className="row" style={{ gap: 4 }}>
                    <button className="btn sm" disabled={rBusy || idx === 0} title="Move up" onClick={() => moveReviewer(r.key, -1)}>↑</button>
                    <button className="btn sm" disabled={rBusy || idx === reviewers.length - 1} title="Move down" onClick={() => moveReviewer(r.key, 1)}>↓</button>
                  </span>
                )}
                <span className="finding-sev">{r.label}</span>
                <span className="finding-msg">{r.desc}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>Runs in order, top to bottom. Empty → default (self → ralph → adversarial).</p>

      <h2>QA checks <span className="muted" style={{ fontSize: "var(--fs-xs)", fontWeight: 400 }}>(click to toggle)</span></h2>
      {!qa ? <StateView kind="loading" /> : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {QA_OPTIONS.map((o) => {
            const on = qa.includes(o.key);
            return (
              <button key={o.key} className={`btn sm ${on ? "acc" : ""}`} disabled={busy} title={o.desc} onClick={() => toggle(o.key)}>
                {on ? "✓ " : "○ "}{o.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>Applies to the QA stage of new runs. Empty → default (tests + build).</p>
    </div>
  );
}
