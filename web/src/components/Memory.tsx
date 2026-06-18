import { useEffect, useState } from "react";
import type { LoomClient, TaskRow, ProjectEntry } from "../api";
import { statusLabel, statusClass } from "../ui";
import { StateView } from "./StateView";
import { Markdown } from "./Markdown";

// F1.4 — task-journal memory: list the BOARD tasks, click one to read the
// agent's reasoning journal for that task (goal, decisions, what was ruled out,
// what was verified) — read live from the task's worktree project, with a
// snapshot fallback so it survives the worktree's deletion.
export function Memory({ client, projects = [] }: { client: LoomClient; projects?: ProjectEntry[] }) {
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
    // Ignore a superseded response: clicking task A then B fires two fetches; if
    // A resolves after B, this guard stops A's pack from overwriting B's.
    let cancelled = false;
    client.boardJournal(sel)
      .then((p) => { if (!cancelled) setPack(p); })
      .catch((e) => { if (!cancelled) setPackErr(String(e)); });
    return () => { cancelled = true; };
  }, [client, sel]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!tasks) return <StateView kind="loading" />;
  if (tasks.length === 0)
    return <StateView kind="empty" msg="No tasks yet — the AI logs its reasoning here as it works on a task." />;

  const selTask = sel ? tasks.find((t) => t.id === sel) : undefined;
  const projName = selTask ? projects.find((p) => p.projectId === selTask.project_id)?.name : undefined;

  return (
    <div>
      <p className="acct-hint" style={{ margin: "0 0 14px" }}>
        The reasoning behind each task — its <b>goal</b>, the <b>decisions</b> made (and the alternatives weighed),
        what was <b>ruled out</b>, and what was <b>verified</b>. Pick a task.
      </p>
      <div className="split">
        <div className="list mem-list">
          {tasks.map((t) => (
            <button key={t.id} className={sel === t.id ? "active" : ""} onClick={() => setSel(t.id)}>
              <span className="t">{t.title}</span>
              <span className="mem-row-meta">
                <span className="crumb">{t.id}</span>
                <span className={`chip ${statusClass(t.status)}`}>
                  <span className="dotc" />
                  {statusLabel(t.status)}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="detail mem-detail">
          {!selTask ? (
            <StateView kind="empty" msg="Pick a task to see its reasoning." />
          ) : (
            <>
              <div className="mem-head">
                <h2 className="mem-title">{selTask.title}</h2>
                <div className="mem-head-meta">
                  <span className={`chip ${statusClass(selTask.status)}`}>
                    <span className="dotc" />
                    {statusLabel(selTask.status)}
                  </span>
                  {projects.length > 1 && projName ? <span className="chip proj">{projName}</span> : null}
                </div>
              </div>
              {packErr ? (
                <StateView kind="error" msg={packErr} />
              ) : pack === null ? (
                <StateView kind="loading" />
              ) : pack.trim() === "" ? (
                <StateView kind="empty" msg="No reasoning recorded for this task yet." />
              ) : (
                <div className="mem-pack"><Markdown text={pack} /></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
