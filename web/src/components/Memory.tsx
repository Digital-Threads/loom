import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData, MemoryDetail } from "../api";
import { StateView } from "./StateView";

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
            <h2>Decisions <span className="n">{detail.decisions.length}</span></h2>
            <h2>Findings <span className="n">{detail.findings.length}</span></h2>
            <h2>Rejections <span className="n">{detail.rejections.length}</span></h2>
          </>
        )}
      </div>
    </div>
  );
}
