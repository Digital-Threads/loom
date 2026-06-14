import { useEffect, useState } from "react";
import { type LoomClient, type TaskDetail, STAGE_LABELS } from "../api";
import { stageStateClass, stageIcon, statusLabel } from "../ui";

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
        <div className="gh">Этапы · {taskId}</div>
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
        </div>
        <div className="pb">
          {active === "rd" || active === "impl" ? (
            <>
              <div className="kv"><b>Steps (R&D / DAG)</b></div>
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
