import { useEffect, useState } from "react";
import { type LoomClient, type TaskDetail, STAGE_LABELS } from "../api";
import { stageStateClass, stageIcon, statusLabel } from "../ui";
import { StageDialog } from "./StageDialog";
import { ReviewQA } from "./ReviewQA";
import { PrDone } from "./PrDone";
import { Approvals } from "./Approvals";

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
  if (!detail) return <div className="empty">Loading…</div>;

  const stageSteps = detail.steps;
  const costs = detail.costs;

  return (
    <div className="task">
      <div className="rail">
        <div className="gh">Stages · {taskId}</div>
        {detail.task.session_id ? (
          <div className="muted" style={{ fontSize: 11, padding: "0 9px 6px" }} title="One live Claude session for the whole task">
            session {detail.task.session_id.slice(0, 8)}
          </div>
        ) : null}
        <div className="steps">
          {detail.stages.map((s) => (
            <button
              key={s.stage_key}
              className={`step ${stageStateClass(s.status)} ${s.stage_key === active ? "active" : ""}`}
              onClick={() => setActive(s.stage_key)}
            >
              <div className="st">{stageIcon(s.status)}</div>
              <div>{STAGE_LABELS[s.stage_key] ?? s.stage_key}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="pane">
        <div className="ph">
          <strong>{STAGE_LABELS[active] ?? active}</strong>
          <span className="tag">{statusLabel(detail.stages.find((s) => s.stage_key === active)?.status ?? "")}</span>
          <span style={{ marginLeft: "auto" }} />
          {detail.task.status === "created" ? (
            <button
              className="btn acc"
              onClick={async () => {
                await client.start(taskId);
                onChanged?.();
              }}
            >
              ▶ Start
            </button>
          ) : detail.stages.find((s) => s.stage_key === active)?.status === "active" ? (
            <button
              className="btn acc"
              onClick={async () => {
                await client.accept(taskId, active);
                onChanged?.();
              }}
            >
              ✓ Accept
            </button>
          ) : null}
          {detail.task.status !== "created" && detail.task.status !== "done" ? (
            <>
              <button className="btn" style={{ marginLeft: 8 }} onClick={async () => { await client.runStageNext(taskId); onChanged?.(); }}>▶ Run stage</button>
              <button className="btn" onClick={async () => { await client.advance(taskId); onChanged?.(); }}>▶▶ Advance</button>
            </>
          ) : null}
        </div>
        <div className="pb">
          <Approvals client={client} taskId={taskId} onChanged={onChanged} />
          {active === "rd" || active === "impl" ? (
            <>
              <div className="kv">
                <b>{active === "rd" ? "Plan (subtasks / DAG)" : "Implementation report"}</b>
                <button className="btn acc" style={{ marginLeft: "auto" }} onClick={runStage}>▶ Run</button>
              </div>
              {planText ? (
                <pre className="b" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{planText}</pre>
              ) : (
                <div className="muted">{active === "rd" ? "No plan yet — run R&D to decompose the task." : "Not implemented yet — run Implementation."}</div>
              )}
              {runId ? (
                <div className="live">
                  <div className="grp">Live · {runId}</div>
                  <pre className="b" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>
                    {live.length ? live.join("\n") : "starting…"}
                  </pre>
                  <div className="fld-row" style={{ gap: 8, marginTop: 8 }}>
                    <input
                      value={stdin}
                      onChange={(e) => setStdin(e.target.value)}
                      placeholder="Intervene — type input for the live agent…"
                      style={{ flex: 1 }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                    <button
                      className="btn"
                      disabled={!stdin}
                      onClick={async () => { await client.sendStdin(runId, stdin + "\n"); setStdin(""); }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              ) : null}
              {stageSteps.length ? (
                stageSteps.map((step) => (
                  <div className="kv" key={step.id}>
                    <b>{step.id}</b>
                    <span>
                      {step.title}
                      {step.profile ? ` · ${step.profile}` : ""}
                      {step.model ? ` · ${step.model}` : ""} · {statusLabel(step.status)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="muted">no steps yet</div>
              )}
            </>
          ) : active === "analysis" || active === "brainstorm" || active === "spec" ? (
            <StageDialog client={client} taskId={taskId} stage={active} onChanged={onChanged} />
          ) : active === "review" || active === "qa" ? (
            <ReviewQA client={client} taskId={taskId} stage={active} />
          ) : active === "pr" || active === "done" ? (
            <PrDone client={client} taskId={taskId} stage={active} onChanged={onChanged} />
          ) : (
            <div className="muted">
              {detail.task.description || "Stage content appears as the task progresses."}
            </div>
          )}

          <div className="kv" style={{ marginTop: 18 }}>
            <b>Cost</b>
            <span>
              {costs.length
                ? costs.map((c) => `${c.source}/${c.metric}: ${c.value}${c.exact ? "" : " ≈"}`).join(" · ")
                : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
