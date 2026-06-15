import { useState } from "react";
import type { LoomClient, RecallHit } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// L7.4 — knowledge recall: search prior reasoning across projects → what was
// already decided vs already rejected (so the team/agent doesn't repeat itself).
export function Knowledge({ client }: { client: LoomClient }) {
  const [q, setQ] = useState("");
  const [decisions, setDecisions] = useState<RecallHit[]>([]);
  const [rejections, setRejections] = useState<RecallHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await client.recall(q.trim());
      setDecisions(r.decisions);
      setRejections(r.rejections);
      setRan(true);
    } catch (e) {
      toast.error(`Recall failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8 }}>
        <input
          className="inp"
          placeholder="e.g. switch to axum, postgres connector…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
        />
        <button className="btn acc" disabled={busy} onClick={search}>Recall</button>
      </div>

      {ran && decisions.length === 0 && rejections.length === 0 ? (
        <StateView kind="empty" msg={`Nothing prior found for “${q}”.`} />
      ) : null}

      {rejections.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>⛔ Already rejected <span className="n">{rejections.length}</span></h2>
          {rejections.map((h, i) => <div className="kv warn" key={i}><b>{h.taskId}</b><span>{h.text}</span></div>)}
        </>
      ) : null}

      {decisions.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>✓ Already decided <span className="n">{decisions.length}</span></h2>
          {decisions.map((h, i) => <div className="kv" key={i}><b>{h.taskId}</b><span>{h.text}</span></div>)}
        </>
      ) : null}
    </div>
  );
}
