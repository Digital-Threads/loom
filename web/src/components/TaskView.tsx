import { useEffect, useState } from "react";
import { type LoomClient, type TaskDetail, STAGE_LABELS } from "../api";
import { stageStateClass, stageIcon, statusLabel } from "../ui";
import { Approvals } from "./Approvals";
import { Transcript } from "./Transcript";
import { StageActions } from "./StageActions";

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

  // Stream a live run of the current stage into the transcript.
  function runStageLive() {
    setLive([]);
    setRunId(null);
    client.startRun(taskId, active).then((id) => {
      setRunId(id);
      const es = new EventSource(client.runStreamUrl(id));
      es.addEventListener("event", (e) => setLive((l) => [...l, (e as MessageEvent).data]));
      es.addEventListener("status", () => { es.close(); setRunId(null); refreshLocal(); onChanged?.(); });
      es.addEventListener("error", () => es.close());
    });
  }

  if (err) return <div className="empty">Error: {err}</div>;
  if (!detail) return <div className="state-loading">Loading task…</div>;

  const task = detail.task;
  const costs = detail.costs;
  const activeStatus = detail.stages.find((s) => s.stage_key === active)?.status ?? "";
  const lastIdx = detail.stages.length - 1;

  // Context input: answer the brainstorm, or intervene in a live run.
  const inputMode: "brainstorm" | "intervene" | null = runId
    ? "intervene"
    : active === "brainstorm" && task.status !== "done"
      ? "brainstorm"
      : null;

  async function submitInput() {
    if (inputMode === "intervene" && runId) {
      client.sendStdin(runId, input + "\n");
      setInput("");
    } else if (inputMode === "brainstorm") {
      setBusy(true);
      try { await client.brainstormMessage(taskId, input.trim() || undefined); setInput(""); refreshLocal(); }
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
                <button className="btn acc sm" onClick={async () => { await client.start(taskId); refreshLocal(); onChanged?.(); }}>▶ Start task</button>
              ) : task.status !== "done" ? (
                <>
                  <StageActions client={client} taskId={taskId} stage={active} status={activeStatus} onRunLive={runStageLive} onChanged={refreshLocal} />
                  {activeStatus === "active" ? (
                    <button className="btn sm" title="Mark this stage done and move on" onClick={async () => { await client.accept(taskId, active); refreshLocal(); onChanged?.(); }}>✓ Approve &amp; continue</button>
                  ) : null}
                  <button className="btn sm" title="Auto-run forward per run mode" onClick={async () => { await client.advance(taskId); refreshLocal(); onChanged?.(); }}>▶▶ Advance</button>
                </>
              ) : null}
            </div>
          </div>
          <p className="ph-desc">{STAGE_DESC[active] ?? ""}</p>
        </header>

        <div className="pb">
          <Approvals client={client} taskId={taskId} onChanged={refreshLocal} />
          <Transcript client={client} taskId={taskId} live={live} runId={runId} reloadKey={reload} />
        </div>

        {inputMode ? (
          <div className="ws-input">
            <input
              value={input}
              disabled={busy}
              placeholder={inputMode === "intervene" ? "Intervene — send guidance to the live agent…" : "Answer the agent (or send empty to get the first question)…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitInput(); }}
            />
            <button className="btn acc" disabled={busy} onClick={submitInput}>{inputMode === "intervene" ? "Send" : "▶"}</button>
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
    </div>
  );
}
