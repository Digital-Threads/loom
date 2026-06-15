import { useEffect, useState } from "react";
import { type LoomClient, type TaskDetail, STAGE_LABELS } from "../api";
import { stageStateClass, stageIcon, statusLabel } from "../ui";
import { Approvals } from "./Approvals";
import { Transcript } from "./Transcript";
import { StageActions } from "./StageActions";
import { StageResult } from "./StageResult";
import { DocPanel } from "./DocPanel";

const STAGE_DESC: Record<string, string> = {
  analysis: "Classify the task and propose its pipeline route.",
  brainstorm: "The agent asks clarifying questions until the goal is clear.",
  spec: "Draft an SDD from the brainstorm; review and accept it.",
  rd: "Decompose the spec into self-sufficient subtasks (a plan / DAG) — no code yet.",
  impl: "Execute the plan in the task worktree and commit the changes.",
  review: "Review the implementation; surface findings to triage.",
  qa: "Run the repo's checks (tests / build).",
  pr: "Generate the PR description; optionally push and open the PR.",
  done: "Finalize and close the task.",
};

function badgeClass(status: string): string {
  if (status === "active") return "badge-acc";
  if (status === "done") return "badge-ok";
  if (status === "skipped") return "badge-dim";
  return "badge-warn";
}

export function TaskView({
  client,
  taskId,
  onChanged,
}: {
  client: LoomClient;
  taskId: string;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<string>("analysis");
  const [runId, setRunId] = useState<string | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [openFile, setOpenFile] = useState<{ path: string; mode: "file" | "diff" } | null>(null);

  const refreshLocal = () => setReload((r) => r + 1);

  useEffect(() => {
    client
      .task(taskId)
      .then((d) => {
        setDetail(d);
        setActive((prev) => {
          if (prev && d.stages.some((s) => s.stage_key === prev)) return prev; // keep selection
          const cur = d.stages.find((s) => s.status === "active") ?? d.stages.find((s) => s.status === "pending");
          return cur ? cur.stage_key : prev;
        });
      })
      .catch((e) => setErr(String(e)));
  }, [client, taskId, reload]);

  // After an action that advances the task (accept, brainstorm done, advance),
  // reload and jump the selection to the new current stage so progress is visible.
  function refreshAndFollow() {
    refreshLocal();
    client.task(taskId).then((d) => {
      setDetail(d);
      const cur = d.stages.find((s) => s.status === "active") ?? d.stages.find((s) => s.status === "pending");
      if (cur) setActive(cur.stage_key);
    }).catch(() => {});
  }

  // Attach an SSE stream of a run to the live transcript pane. follow=true (a
  // stage run) jumps the selection to the new current stage when it finishes, so
  // the pipeline visibly moves forward; chat replies keep the current selection.
  function attachStream(id: string, follow = false) {
    setRunId(id);
    const es = new EventSource(client.runStreamUrl(id));
    es.addEventListener("event", (e) => setLive((l) => [...l, (e as MessageEvent).data]));
    es.addEventListener("status", () => {
      es.close();
      setRunId(null);
      if (follow) {
        client.task(taskId).then((d) => {
          setDetail(d);
          const cur = d.stages.find((s) => s.status === "active") ?? d.stages.find((s) => s.status === "pending");
          if (cur) setActive(cur.stage_key);
        }).catch(() => {});
      }
      refreshLocal();
      onChanged?.();
    });
    es.addEventListener("error", () => es.close());
  }

  // Stream a live run of the current stage into the transcript.
  function runStageLive() {
    setLive([]);
    setRunId(null);
    client.startRun(taskId, active).then((id) => attachStream(id, true));
  }

  // Reconnect to a run that's still going when we (re)open the task — the stream
  // replays its buffered output, so a run started before a reload/navigation is
  // picked back up instead of looking lost.
  useEffect(() => {
    let cancelled = false;
    client.activeRun(taskId).then((rid) => {
      if (!cancelled && rid) { setLive([]); attachStream(rid, true); }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, taskId]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!detail) return <div className="state-loading">Loading task…</div>;

  const task = detail.task;
  const costs = detail.costs;
  const activeStatus = detail.stages.find((s) => s.stage_key === active)?.status ?? "";
  const lastIdx = detail.stages.length - 1;

  // Context input: intervene in a live run, answer the brainstorm, or — at any
  // other stage — chat with the agent freely (talk to it about its work).
  const inputMode: "brainstorm" | "intervene" | "chat" | null = runId
    ? "intervene"
    : task.status === "done" || task.status === "created"
      ? null
      : active === "brainstorm"
        ? "brainstorm"
        : "chat";

  async function submitInput() {
    const text = input.trim();
    if (inputMode === "intervene" && runId) {
      client.sendStdin(runId, input + "\n");
      setInput("");
    } else if (inputMode === "brainstorm") {
      setBusy(true);
      try { await client.brainstormMessage(taskId, text || undefined); setInput(""); refreshLocal(); }
      finally { setBusy(false); }
    } else if (inputMode === "chat") {
      if (!text) return;
      setBusy(true);
      setLive([]);
      try { const id = await client.chat(taskId, text, active); setInput(""); attachStream(id); }
      finally { setBusy(false); }
    }
  }

  return (
    <div className="task">
      <aside className="rail">
        <div className="rail-head">
          <div className="rail-title">{task.title}</div>
          <div className="rail-sub">
            <span className="chip">{task.run_mode}</span>
            {task.session_id ? (
              <span className="chip" title="One live Claude session for the whole task">◦ {task.session_id.slice(0, 8)}</span>
            ) : null}
          </div>
        </div>
        <div className="steps">
          {detail.stages.map((s, i) => (
            <button
              key={s.stage_key}
              className={`step ${stageStateClass(s.status)} ${s.stage_key === active ? "active" : ""}`}
              onClick={() => setActive(s.stage_key)}
            >
              <span className="step-rail">
                <span className="st">{stageIcon(s.status)}</span>
                {i < lastIdx ? <span className="step-line" /> : null}
              </span>
              <span className="step-main">
                <span className="step-label">{STAGE_LABELS[s.stage_key] ?? s.stage_key}</span>
                <span className="step-state">{statusLabel(s.status)}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="pane">
        <header className="ph">
          <div className="ph-top">
            <h2 className="ph-title">{STAGE_LABELS[active] ?? active}</h2>
            <span className={`badge ${badgeClass(activeStatus)}`}>{statusLabel(activeStatus)}</span>
            <div className="ph-actions">
              {task.status === "created" ? (
                <button className="btn acc sm" onClick={async () => { await client.start(taskId); refreshAndFollow(); onChanged?.(); }}>▶ Start task</button>
              ) : task.status !== "done" ? (
                <>
                  <StageActions client={client} taskId={taskId} stage={active} status={activeStatus} onRunLive={runStageLive} onChanged={refreshAndFollow} />
                  {activeStatus === "active" ? (
                    <button className="btn sm" title="Mark this stage done and move on" onClick={async () => { await client.accept(taskId, active); refreshAndFollow(); onChanged?.(); }}>✓ Approve &amp; continue</button>
                  ) : null}
                  <button className="btn sm" title="Auto-run forward per run mode" onClick={async () => { await client.advance(taskId); refreshAndFollow(); onChanged?.(); }}>▶▶ Advance</button>
                </>
              ) : null}
              {task.repo ? (
                <button className="btn sm" title="Show the code changes (git diff)" onClick={() => setOpenFile({ path: "", mode: "diff" })}>⊟ Changes</button>
              ) : null}
            </div>
          </div>
          <p className="ph-desc">{STAGE_DESC[active] ?? ""}</p>
        </header>

        <div className="pb">
          <Approvals client={client} taskId={taskId} onChanged={refreshLocal} />
          <StageResult client={client} taskId={taskId} stage={active} reloadKey={reload} />
          <Transcript client={client} taskId={taskId} live={live} runId={runId} reloadKey={reload} onOpenFile={(p) => setOpenFile({ path: p, mode: "file" })} />
        </div>

        {inputMode ? (
          <div className="ws-input">
            <input
              value={input}
              disabled={busy}
              placeholder={
                inputMode === "intervene"
                  ? "Intervene — send guidance to the live agent…"
                  : inputMode === "brainstorm"
                    ? "Answer the agent (or send empty to get the first question)…"
                    : "Message the agent — answer it, correct it, or point it somewhere…"
              }
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitInput(); }}
            />
            <button className="btn acc" disabled={busy} onClick={submitInput}>{inputMode === "brainstorm" ? "▶" : "Send"}</button>
          </div>
        ) : null}

        <div className="cost-bar">
          <span className="cost-label">Cost</span>
          {costs.length ? (
            costs.map((c, i) => (
              <span className="cost-stat" key={i}><b>{c.value}{c.exact ? "" : " ≈"}</b> {c.source}/{c.metric}</span>
            ))
          ) : (
            <span className="muted">—</span>
          )}
        </div>
      </section>
      {openFile ? <DocPanel client={client} taskId={taskId} path={openFile.path} mode={openFile.mode} onClose={() => setOpenFile(null)} /> : null}
    </div>
  );
}
