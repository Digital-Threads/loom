import { useState } from "react";
import type { LoomClient, RecallHit, GraphNodeKind } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";
import { useT } from "../i18n";

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
  const t = useT();
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
      toast.error(`${t("knowledge.recallFailed")}: ${rRes.reason}`);
      setDecisions([]); setRejections([]); setHits([]);
    }
    if (sRes.status === "fulfilled") setSimilar(sRes.value.hits);
    else { setSimilar([]); toast.error(`${t("knowledge.searchFailed")}: ${sRes.reason}`); }
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
    <div className="panel knowledge">
      <div className="row" style={{ gap: 8 }}>
        <input
          className="inp"
          placeholder={t("knowledge.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
        />
        <button className="btn acc" disabled={busy} onClick={search}>{t("knowledge.recall")}</button>
      </div>

      {busy ? <StateView kind="loading" msg={t("knowledge.searching")} /> : null}

      {!busy && !ran ? (
        <StateView kind="empty" msg={t("knowledge.introHint")} />
      ) : null}

      {!busy && ran && nothing ? (
        <StateView kind="empty" msg={`${t("knowledge.nothingPrefix")}“${lastQ}”.`} />
      ) : null}

      {rejections.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>⛔ {t("knowledge.alreadyRejected")} <span className="n">{rejections.length}</span></h2>
          {rejections.map((h, i) => <div className="kv warn" key={i}><b>{h.taskId}</b><span>{h.text}</span></div>)}
        </>
      ) : null}

      {decisions.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>✓ {t("knowledge.alreadyDecided")} <span className="n">{decisions.length}</span></h2>
          {decisions.map((h, i) => <div className="kv" key={i}><b>{h.taskId}</b><span>{h.text}</span></div>)}
        </>
      ) : null}

      {chains.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>🕸 {t("knowledge.reasoningGraph")} <span className="n">{hits.length}</span></h2>
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
          <h2 style={{ marginTop: 18 }}>≈ {t("knowledge.similarReasoning")} <span className="n">{similarUnique.length}</span></h2>
          {similarUnique.map((h, i) => <div className="kv" key={i}><b>{h.taskId}</b><span>{h.text}</span></div>)}
        </>
      ) : null}
    </div>
  );
}
