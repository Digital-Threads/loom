import { useState } from "react";
import type { LoomClient, RecallHit, GraphNodeKind } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// L7.4 — knowledge recall: search prior reasoning across projects → what was
// already decided vs already rejected (so the team/agent doesn't repeat itself).
// Also shows a problem→solution graph and semantically-similar prior reasoning.
type ChainNode = { id: string; kind: GraphNodeKind; label: string };

function kindOf(eventType: string): GraphNodeKind {
  if (eventType === "decision") return "decision";
  if (eventType === "rejection") return "rejection";
  return "other";
}

// Build per-task reasoning chains from the recall hits the server already
// returned — no second round-trip / no duplicate `task-journal recall` spawn.
function chainsFromHits(hits: RecallHit[]): { taskId: string; nodes: ChainNode[] }[] {
  const order: string[] = [];
  const byTask = new Map<string, ChainNode[]>();
  hits.forEach((h, i) => {
    if (!byTask.has(h.taskId)) { byTask.set(h.taskId, []); order.push(h.taskId); }
    byTask.get(h.taskId)!.push({ id: `n${i}`, kind: kindOf(h.eventType), label: h.text });
  });
  return order.map((taskId) => ({ taskId, nodes: byTask.get(taskId)! }));
}

const dedupeKey = (h: RecallHit) => `${h.taskId}\0${h.text}`;

export function Knowledge({ client }: { client: LoomClient }) {
  const [q, setQ] = useState("");
  const [lastQ, setLastQ] = useState("");
  const [decisions, setDecisions] = useState<RecallHit[]>([]);
  const [rejections, setRejections] = useState<RecallHit[]>([]);
  const [hits, setHits] = useState<RecallHit[]>([]);
  const [similar, setSimilar] = useState<RecallHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [ran, setRan] = useState(false);

  async function search() {
    if (busy) return; // guard re-entry (Enter ignores the disabled button)
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setLastQ(query);
    // recall and search are independent — one failing must not drop the other.
    const [rRes, sRes] = await Promise.allSettled([client.recall(query), client.search(query)]);
    if (rRes.status === "fulfilled") {
      setDecisions(rRes.value.decisions);
      setRejections(rRes.value.rejections);
      setHits(rRes.value.hits);
    } else {
      toast.error(`Recall failed: ${rRes.reason}`);
      setDecisions([]); setRejections([]); setHits([]);
    }
    if (sRes.status === "fulfilled") setSimilar(sRes.value.hits);
    else { setSimilar([]); toast.error(`Search failed: ${sRes.reason}`); }
    setRan(true);
    setBusy(false);
  }

  const chains = chainsFromHits(hits);
  // Drop "similar" rows already shown as a recall hit, so the same journal
  // entry isn't listed twice.
  const shown = new Set(hits.map(dedupeKey));
  const similarUnique = similar.filter((h) => !shown.has(dedupeKey(h)));
  const nothing = decisions.length === 0 && rejections.length === 0 && hits.length === 0 && similarUnique.length === 0;

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

      {busy ? <StateView kind="loading" msg="Searching prior reasoning…" /> : null}

      {!busy && !ran ? (
        <StateView kind="empty" msg="Search prior reasoning across this project — what was already decided or rejected. Try a topic, e.g. “switch to axum”." />
      ) : null}

      {!busy && ran && nothing ? (
        <StateView kind="empty" msg={`Nothing prior found for “${lastQ}”.`} />
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

      {chains.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>🕸 Reasoning graph <span className="n">{hits.length}</span></h2>
          {chains.map((c) => (
            <div className="kg-group" key={c.taskId}>
              <b className="kg-task">{c.taskId}</b>
              <div className="kg-chain">
                {c.nodes.map((n, i) => (
                  <span className="kg-link" key={n.id}>
                    {i > 0 ? <span className="kg-arrow">→</span> : null}
                    <span className={`kg-node ${n.kind}`} title={n.label}>{n.label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {similarUnique.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>≈ Similar prior reasoning <span className="n">{similarUnique.length}</span></h2>
          {similarUnique.map((h, i) => <div className="kv" key={i}><b>{h.taskId}</b><span>{h.text}</span></div>)}
        </>
      ) : null}
    </div>
  );
}
