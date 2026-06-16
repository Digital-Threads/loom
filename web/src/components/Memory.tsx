import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData } from "../api";
import { StateView } from "./StateView";
import { Markdown } from "./Markdown";

// F1.4 — task-journal memory: list tj tasks, click to render the task's own
// readable dossier (task-journal's `pack`): goal, decisions+alternatives,
// rejected, evidence, artifacts (commits/PRs/files), lifecycle.
export function Memory({ client }: { client: LoomClient }) {
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [pack, setPack] = useState<string | null>(null);

  useEffect(() => {
    client.workspace().then(setWs).catch((e) => setErr(String(e)));
  }, [client]);

  useEffect(() => {
    if (!sel) return;
    setPack(null);
    client.memoryPack(sel).then(setPack).catch(() => setPack(""));
  }, [client, sel]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!ws) return <StateView kind="loading" />;
  if (ws.tasks.length === 0)
    return <StateView kind="empty" msg="No reasoning recorded yet — the AI logs its thinking here as it works on tasks." />;

  return (
    <div>
      <p className="acct-hint" style={{ margin: "0 0 14px" }}>
        The full story of each task — goal, the <b>decisions</b> made (and the alternatives weighed),
        what was <b>ruled out</b>, what was <b>verified</b>, and the artifacts (commits, PRs, files). Pick a task.
      </p>
      <div className="split">
        <div className="list">
          {ws.tasks.map((t) => (
            <button key={t.id} className={sel === t.id ? "active" : ""} onClick={() => setSel(t.id)}>
              <span className="t">{t.title}</span>
              <span className="mem-row-meta">
                <span className="crumb">{t.id}</span>
                <span className={`chip ${t.status === "closed" ? "ok" : ""}`}>{(t.status as string) ?? "open"}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="detail">
          {!sel ? (
            <StateView kind="empty" msg="Pick a task to see its full history." />
          ) : pack === null ? (
            <StateView kind="loading" />
          ) : pack.trim() === "" ? (
            <div className="muted mem-none">No history recorded for this task yet.</div>
          ) : (
            <div className="mem-pack"><Markdown text={pack} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
