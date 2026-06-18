import { useEffect, useState } from "react";
import type { LoomClient, TaskRow } from "../api";
import { StateView } from "./StateView";
import { Markdown } from "./Markdown";

// F1.4 — task-journal memory: list the BOARD tasks, click one to read the
// agent's reasoning journal for that task (goal, decisions, what was ruled out,
// what was verified) — read live from the task's worktree project, with a
// snapshot fallback so it survives the worktree's deletion.
export function Memory({ client }: { client: LoomClient }) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [pack, setPack] = useState<string | null>(null);
  const [packErr, setPackErr] = useState<string | null>(null);

  useEffect(() => {
    client.tasks().then(setTasks).catch((e) => setErr(String(e)));
  }, [client]);

  useEffect(() => {
    if (!sel) return;
    setPack(null);
    setPackErr(null);
    client.boardJournal(sel).then(setPack).catch((e) => setPackErr(String(e)));
  }, [client, sel]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!tasks) return <StateView kind="loading" />;
  if (tasks.length === 0)
    return <StateView kind="empty" msg="No tasks yet — the AI logs its reasoning here as it works on a task." />;

  return (
    <div>
      <p className="acct-hint" style={{ margin: "0 0 14px" }}>
        The reasoning behind each task — its <b>goal</b>, the <b>decisions</b> made (and the alternatives weighed),
        what was <b>ruled out</b>, and what was <b>verified</b>. Pick a task.
      </p>
      <div className="split">
        <div className="list">
          {tasks.map((t) => (
            <button key={t.id} className={sel === t.id ? "active" : ""} onClick={() => setSel(t.id)}>
              <span className="t">{t.title}</span>
              <span className="mem-row-meta">
                <span className="crumb">{t.id}</span>
                <span className={`chip ${t.status === "done" ? "ok" : ""}`}>{t.status}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="detail">
          {!sel ? (
            <StateView kind="empty" msg="Pick a task to see its reasoning." />
          ) : packErr ? (
            <StateView kind="error" msg={packErr} />
          ) : pack === null ? (
            <StateView kind="loading" />
          ) : pack.trim() === "" ? (
            <StateView kind="empty" msg="No reasoning recorded for this task yet." />
          ) : (
            <div className="mem-pack"><Markdown text={pack} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
