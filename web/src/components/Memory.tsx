import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData, MemoryDetail } from "../api";

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

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;
  if (!ws) return <div className="empty">Loading…</div>;
  if (ws.tasks.length === 0)
    return <div className="empty">No task-journal tasks yet.</div>;

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
          <div className="empty">Pick a task to see its reasoning.</div>
        ) : !detail ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <h2>Decisions <span className="n">{detail.decisions.length}</span></h2>
            <h2>Findings <span className="n">{detail.findings.length}</span></h2>
            <h2>Rejections <span className="n">{detail.rejections.length}</span></h2>
          </>
        )}
      </div>
    </div>
  );
}
