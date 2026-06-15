import { useEffect, useState } from "react";
import { type LoomClient, type TaskDetail, STAGE_LABELS } from "../api";
import { stageStateClass, stageIcon, statusLabel } from "../ui";
import { StageDialog } from "./StageDialog";
import { ReviewQA } from "./ReviewQA";
import { PrDone } from "./PrDone";
import { Approvals } from "./Approvals";

// Short human description per stage — shown under the stage title.
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
  const [stdin, setStdin] = useState("");
  const [planText, setPlanText] = useState<string | null>(null);

  useEffect(() => {
    if (active === "rd") client.rdGet(taskId).then(setPlanText).catch(() => {});
    else if (active === "impl") client.implGet(taskId).then(setPlanText).catch(() => {});
    else setPlanText(null);
  }, [client, taskId, active]);

  async function runStage() {
    setLive([]);
    setRunId(null);
    const id = await client.startRun(taskId, active);
    setRunId(id);
    const es = new EventSource(client.runStreamUrl(id));
    es.addEventListener("event", (e) => setLive((l) => [...l, (e as MessageEvent).data]));
    es.addEventListener("status", () => { es.close(); onChanged?.(); });
    es.addEventListener("error", () => es.close());
  }

  useEffect(() => {
    client
      .task(taskId)
      .then((d) => {
        setDetail(d);
        const cur = d.stages.find((s) => s.status === "active") ?? d.stages.find((s) => s.status === "pending");
        if (cur) setActive(cur.stage_key);
      })
      .catch((e) => setErr(String(e)));
  }, [client, taskId]);

  if (err) return <div className="empty">Error: {err}</div>;
  if (!detail) return <div className="state-loading">Loading task…</div>;

  const stageSteps = detail.steps;
  const costs = detail.costs;
  const task = detail.task;
  const activeStatus = detail.stages.find((s) => s.stage_key === active)?.status ?? "";
  const lastIdx = detail.stages.length - 1;

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
                <button className="btn acc" onClick={async () => { await client.start(taskId); onChanged?.(); }}>▶ Start task</button>
              ) : task.status !== "done" ? (
                <>
                  {activeStatus === "active" ? (
                    <button className="btn" title="Mark this stage done and move to the next" onClick={async () => { await client.accept(taskId, active); onChanged?.(); }}>✓ Approve &amp; continue</button>
                  ) : null}
                  <button className="btn acc" title="Auto-run forward through the pipeline (per run mode)" onClick={async () => { await client.advance(taskId); onChanged?.(); }}>▶▶ Advance</button>
                </>
              ) : null}
            </div>
          </div>
          <p className="ph-desc">{STAGE_DESC[active] ?? ""}</p>
        </header>

        <div className="pb">
          <Approvals client={client} taskId={taskId} onChanged={onChanged} />

          {active === "rd" || active === "impl" ? (
            <div className="card-plain">
              <div className="card-head">
                <span>{active === "rd" ? "Plan — subtasks / DAG" : "Implementation report"}</span>
                <button className="btn acc sm" onClick={runStage}>▶ Run</button>
              </div>
              {planText ? (
                <pre className="doc">{planText}</pre>
              ) : (
                <div className="state-empty">{active === "rd" ? "No plan yet — run R&D to decompose the task." : "Not implemented yet — run Implementation."}</div>
              )}

              {runId ? (
                <div className="term">
                  <div className="term-head"><span className="dotc run" /> Live · {runId.slice(0, 12)}</div>
                  <pre className="term-body">{live.length ? live.join("\n") : "starting…"}</pre>
                  <div className="term-input">
                    <input
                      value={stdin}
                      onChange={(e) => setStdin(e.target.value)}
                      placeholder="Intervene — send guidance to the live agent…"
                      onKeyDown={(e) => { if (e.key === "Enter" && stdin) { client.sendStdin(runId, stdin + "\n"); setStdin(""); } }}
                    />
                    <button className="btn sm" disabled={!stdin} onClick={() => { client.sendStdin(runId, stdin + "\n"); setStdin(""); }}>Send</button>
                  </div>
                </div>
              ) : null}

              {stageSteps.length ? (
                <div className="steps-list">
                  {stageSteps.map((step) => (
                    <div className="step-row" key={step.id}>
                      <span className="step-row-id">{step.id}</span>
                      <span className="step-row-t">{step.title}{step.profile ? ` · ${step.profile}` : ""}{step.model ? ` · ${step.model}` : ""}</span>
                      <span className="chip">{statusLabel(step.status)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : active === "analysis" || active === "brainstorm" || active === "spec" ? (
            <StageDialog client={client} taskId={taskId} stage={active} onChanged={onChanged} />
          ) : active === "review" || active === "qa" ? (
            <ReviewQA client={client} taskId={taskId} stage={active} />
          ) : active === "pr" || active === "done" ? (
            <PrDone client={client} taskId={taskId} stage={active} onChanged={onChanged} />
          ) : (
            <div className="state-empty">{task.description || "Stage content appears as the task progresses."}</div>
          )}

          <div className="cost-bar">
            <span className="cost-label">Cost</span>
            {costs.length ? (
              costs.map((c, i) => (
                <span className="cost-stat" key={i}>
                  <b>{c.value}{c.exact ? "" : " ≈"}</b> {c.source}/{c.metric}
                </span>
              ))
            ) : (
              <span className="muted">—</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
