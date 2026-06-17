import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// Quality module — @digital-threads/loom-quality. The review pipeline (fixed:
// self/ralph/adversarial) plus the editable QA checks (persisted via flow-config).
const QA_OPTIONS = [
  { key: "tests", label: "tests", desc: "repo test script" },
  { key: "build", label: "build", desc: "repo build script" },
  { key: "browser", label: "browser", desc: "E2E via the canary connector" },
];
const REVIEWERS = [
  { key: "self", label: "Self review", desc: "The task session reviews its own changes." },
  { key: "ralph", label: "Ralph-loop", desc: "Iterative review, up to 3 passes." },
  { key: "adversarial", label: "Adversarial", desc: "/adversarial-review — tries to break the solution." },
];

export function Quality({ client }: { client: LoomClient }) {
  const [qa, setQa] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.flowConfig("qa").then(setQa).catch((e) => setErr(String(e))); }, [client]);

  function toggle(key: string) {
    if (!qa) return;
    const next = qa.includes(key) ? qa.filter((k) => k !== key) : [...qa, key];
    setQa(next);
    setBusy(true);
    client.saveFlowConfig("qa", next).then(() => toast.success("QA saved")).catch((e) => toast.error(`Couldn't save: ${e}`)).finally(() => setBusy(false));
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        AI code review + quality checks. Standalone package <code>@digital-threads/loom-quality</code>.
      </p>

      <h2>Review pipeline <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(fixed; findings accumulate → one fix)</span></h2>
      <ul className="finding-list">
        {REVIEWERS.map((r) => (
          <li key={r.key} className="finding sev-info">
            <span className="finding-sev">{r.label}</span>
            <span className="finding-msg">{r.desc}</span>
          </li>
        ))}
      </ul>

      <h2>QA checks <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(click to toggle)</span></h2>
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
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Applies to the QA stage of new runs. Empty → default (tests + build).</p>
    </div>
  );
}
