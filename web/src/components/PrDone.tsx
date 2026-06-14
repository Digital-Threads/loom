import { useState } from "react";
import type { LoomClient } from "../api";

// L14.3 — PR / Done panels: generate the PR description (+ optional create) and
// finalize the task.
export function PrDone({ client, taskId, stage, onChanged }: { client: LoomClient; taskId: string; stage: string; onChanged?: () => void }) {
  const [pr, setPr] = useState<{ description: string; created: boolean; url?: string } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connector, setConnector] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (stage === "pr") setPr(await client.prRun(taskId, { connector }));
      else { await client.doneRun(taskId); setDone(true); onChanged?.(); }
    } finally {
      setBusy(false);
    }
  }

  if (stage === "done") {
    return (
      <div>
        <button className="btn acc" disabled={busy || done} onClick={run}>{done ? "✓ Done" : "Finish task"}</button>
      </div>
    );
  }

  return (
    <div>
      <label className="fld-check" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input type="checkbox" checked={connector} onChange={(e) => setConnector(e.target.checked)} />
        <span>Push branch & open PR on GitHub (gh)</span>
      </label>
      <button className="btn acc" disabled={busy} onClick={run}>{connector ? "▶ Create PR" : "▶ Generate description"}</button>
      {pr ? (
        <>
          <div className="kv" style={{ marginTop: 10 }}>
            <b>{pr.created ? "✓ PR created" : "description ready"}</b>
            <span>{pr.url ? <a href={pr.url}>{pr.url}</a> : "copy below"}</span>
          </div>
          <pre className="b" style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>{pr.description}</pre>
        </>
      ) : null}
    </div>
  );
}
