import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData, MemoryDetail, MemoryEntry } from "../api";
import { StateView } from "./StateView";

// One group of reasoning entries (decisions / findings / rejections) — the
// actual text, not just a count.
function MemGroup({ title, items, tone }: { title: string; items: MemoryEntry[]; tone?: string }) {
  return (
    <div className="mem-group">
      <h2>{title} <span className="n">{items.length}</span></h2>
      {items.length === 0 ? (
        <div className="muted mem-none">none</div>
      ) : (
        items.map((e, i) => (
          <div className={`mem-entry ${tone ?? ""}`} key={e.event_id ?? i}>
            <div className="mem-text">{e.text}</div>
            {e.timestamp ? (
              <div className="mem-meta">
                {new Date(e.timestamp).toLocaleString()}{e.source ? ` · ${e.source}` : ""}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

// F1.4 — task-journal memory: list tj tasks, click to drill into a task's
// decisions/findings/rejections.
export function Memory({ client }: { client: LoomClient }) {
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemoryDetail | null>(null);

  useEffect(() => {
    client.workspace().then(setWs).catch((e) => setErr(String(e)));
  }, [client]);

  useEffect(() => {
    if (!sel) return;
    setDetail(null);
    client.memoryTask(sel).then(setDetail).catch(() => setDetail(null));
  }, [client, sel]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!ws) return <StateView kind="loading" />;
  if (ws.tasks.length === 0)
    return <StateView kind="empty" msg="No task-journal tasks yet." />;

  return (
    <div className="split">
      <div className="list">
        {ws.tasks.map((t) => (
          <button key={t.id} className={sel === t.id ? "active" : ""} onClick={() => setSel(t.id)}>
            <span className="t">{t.title}</span>
            <span className="crumb">{t.id}</span>
          </button>
        ))}
      </div>
      <div className="detail">
        {!sel ? (
          <StateView kind="empty" msg="Pick a task to see its reasoning." />
        ) : !detail ? (
          <StateView kind="loading" />
        ) : (
          <>
            <MemGroup title="Decisions" items={detail.decisions} />
            <MemGroup title="Findings" items={detail.findings} />
            <MemGroup title="Rejections" items={detail.rejections} tone="warn" />
          </>
        )}
      </div>
    </div>
  );
}
