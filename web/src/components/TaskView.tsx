import { useEffect, useRef, useState } from "react";
import { type LoomClient, type TaskDetail, type RateLimit, STAGE_LABELS } from "../api";
import { stageStateClass, stageIcon, statusLabel } from "../ui";
import { Approvals } from "./Approvals";
import { Transcript } from "./Transcript";
import { StageActions } from "./StageActions";
import { StageResult } from "./StageResult";
import { DocPanel } from "./DocPanel";
import { CostBar } from "./CostBar";
import { StateView } from "./StateView";
import { Modal } from "./Modal";
import { LimitModal } from "./LimitModal";
import { Markdown } from "./Markdown";
import { toast } from "../toast";

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

// The review stage runs three reviewers in order, accumulating findings; the
// user approves & runs the next between them, then fixes all findings once.
const REVIEWER_ORDER = ["self", "ralph", "adversarial"] as const;
const REVIEWER_LABELS: Record<string, string> = { self: "Self review", ralph: "Ralph-loop", adversarial: "Adversarial" };

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
  const [active, setActive] = useState<string>(""); // set to the task's current stage on first load (see task() effect)
  const [runId, setRunId] = useState<string | null>(null);
  const [live, setLive] = useState<string[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [openFile, setOpenFile] = useState<{ path: string; mode: "file" | "diff" } | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [reviewFindings, setReviewFindings] = useState(0);
  const [reviewersDone, setReviewersDone] = useState<string[]>([]);
  const [reviewerBusy, setReviewerBusy] = useState(false);
  const [history, setHistory] = useState<string | null | undefined>(undefined); // undefined=closed, null=loading
  const [limit, setLimit] = useState<RateLimit | null>(null);
  const dismissedRef = useRef<string>("");
  // true → the open task follows the live active stage; set false when the user
  // clicks a stage tab (so we don't yank their view), re-armed on explicit runs.
  const followLiveRef = useRef(true);

  useEffect(() => {
    client.workspace().then((w) => {
      setProfiles(w.subscriptions.map((s) => s.name).filter(Boolean));
      setActiveProfile(w.activeProfile ?? "");
    }).catch(() => {});
    // Resolve the task's project name (shown in the rail instead of the raw path).
    client.projects().then((d) => {
      const t = detail?.task;
      const proj = d.projects.find((p) => p.projectId === (t?.project_id ?? "")) ?? d.projects.find((p) => p.root === t?.repo);
      setProjectName(proj?.name ?? "");
    }).catch(() => {});
  }, [client, detail?.task]);

  // While a run is live, watch the current subscription's rate limit. Near the
  // cap (5h ≥ 90% or status=limited) → prompt to switch before it stalls.
  const curProfile = detail?.task.profile ?? "";
  useEffect(() => {
    if (!runId || !curProfile) return;
    let alive = true;
    let inflight = false; // don't stack (a slow limits call would block the pool)
    const check = () => {
      if (inflight) return;
      inflight = true;
      client.accountLimits(curProfile).then((ls) => {
        if (!alive) return;
        const l = ls.find((x) => x.profile === curProfile);
        if (l && (l.fiveHourPct >= 90 || l.status === "limited") && dismissedRef.current !== curProfile) {
          setLimit(l);
        }
      }).catch(() => {}).finally(() => { inflight = false; });
    };
    check();
    const iv = setInterval(check, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [runId, curProfile, client]);

  // When the task is PARKED on a rate limit (the run already stopped → no live
  // runId, so the watcher above is off), still surface the switch-account modal —
  // not just the banner — so the user is prompted to pick a healthy subscription.
  const stoppedProfile = detail?.stopReason?.kind === "rate_limit" ? (detail.stopReason.profile ?? curProfile) : "";
  useEffect(() => {
    if (!stoppedProfile || dismissedRef.current === stoppedProfile) return;
    let alive = true;
    const fallback: RateLimit = { profile: stoppedProfile, fiveHourPct: 100, weeklyPct: 0, status: "rejected" };
    client.accountLimits(stoppedProfile)
      .then((ls) => { if (alive) setLimit(ls.find((x) => x.profile === stoppedProfile) ?? fallback); })
      .catch(() => { if (alive) setLimit(fallback); });
    return () => { alive = false; };
  }, [stoppedProfile, client]);

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

  // While the task is running, poll its detail so the stage rail + status badges
  // follow the pipeline LIVE. The autopilot run streams the whole pipeline as one
  // SSE run, whose terminal "status" event only fires when everything finishes —
  // so without this poll the open task view stays stale (stages frozen) until the
  // very end, even though the board (which polls) already moved the card. Auto-
  // follow the active stage unless the user pinned one by clicking its tab.
  useEffect(() => {
    if (detail?.task.status !== "running") return;
    let alive = true;
    let inflight = false; // never stack requests — a slow server would exhaust the
    const tick = () => {   // browser's per-host connection pool and freeze the UI.
      if (inflight) return;
      inflight = true;
      client.task(taskId).then((d) => {
        if (!alive) return;
        setDetail(d);
        if (followLiveRef.current) {
          const cur = d.stages.find((s) => s.status === "active");
          if (cur) setActive(cur.stage_key);
        }
      }).catch(() => {}).finally(() => { inflight = false; });
    };
    const iv = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(iv); };
  }, [client, taskId, detail?.task.status]);

  // After an action that advances the task (accept, brainstorm done, advance),
  // reload and jump the selection to the new current stage so progress is visible.
  function refreshAndFollow() {
    followLiveRef.current = true; // explicit forward action → resume live-follow
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
    setReconnecting(false);
    let done = false;
    let buf: string[] = [];
    const es = new EventSource(client.runStreamUrl(id));
    // The server replays the whole output buffer on every (re)connection, so we
    // rebuild from scratch each time a connection opens — no duplicates after a
    // reconnect, and a mid-run network drop recovers on its own.
    es.addEventListener("open", () => { buf = []; setLive([]); setReconnecting(false); });
    es.addEventListener("event", (e) => { buf.push((e as MessageEvent).data); setLive([...buf]); });
    es.addEventListener("status", () => {
      done = true;
      es.close();
      setRunId(null);
      setReconnecting(false);
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
    es.addEventListener("error", (e) => {
      // a server-sent "error" event (unknown run) carries data → terminal. A bare
      // connection error → let EventSource retry natively; show "reconnecting".
      if (done || (e as MessageEvent).data) { es.close(); setRunId(null); setReconnecting(false); }
      else setReconnecting(true);
    });
  }

  // Stream a live run of the current stage into the transcript.
  function runStageLive() {
    followLiveRef.current = true; // running a stage → follow the pipeline live
    setLive([]);
    setRunId(null);
    client.startRun(taskId, active).then((id) => attachStream(id, true)).catch((e) => toast.error(`Couldn’t start the stage: ${e}`));
  }

  // Send the review findings back to the agent to fix (impl round-trip → re-review).
  function fixFindings() {
    setLive([]);
    client.reviewFix(taskId).then((rid) => attachStream(rid, true)).catch((e) => toast.error(`Couldn’t start the fix: ${e}`));
  }

  // Approve the current reviewer and run the next one in the pipeline (its
  // findings accumulate). Plain request (not streamed) — the agent runs the
  // skill/loop under the hood; we refresh the result card when it returns.
  function runNextReviewer() {
    setReviewerBusy(true);
    client.reviewRun(taskId)
      .then(() => { setReload((n) => n + 1); refreshLocal(); })
      .catch((e) => toast.error(`Couldn’t run the reviewer: ${e}`))
      .finally(() => setReviewerBusy(false));
  }

  // Review pipeline progress drives the header actions: how many findings so far,
  // which reviewers have run, and the next reviewer still to run.
  useEffect(() => {
    if (active !== "review") { setReviewFindings(0); setReviewersDone([]); return; }
    client.reviewGet(taskId)
      .then((r) => { setReviewFindings(r.result?.findings?.length ?? 0); setReviewersDone(r.reviewersDone ?? []); })
      .catch(() => { setReviewFindings(0); setReviewersDone([]); });
  }, [client, taskId, active, reload]);
  // Next reviewer to run (undefined → all three done → fix all findings).
  const reviewNext = REVIEWER_ORDER.find((k) => !reviewersDone.includes(k));

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

  if (err) return <StateView kind="error" msg={err} />;
  if (!detail) return <StateView kind="loading" msg="Loading task…" />;

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
          {projectName ? <div className="rail-project">{projectName}</div> : null}
          <div className="rail-title">{task.title}</div>
          <div className="rail-sub">
            <span className="chip">{task.run_mode}</span>
            {profiles.length ? (
              (() => {
                // Effective account: the task's pinned profile, else the active
                // one it falls back to. Always show *something* so it's never
                // ambiguous which account runs the task.
                const effective = task.profile || activeProfile || "";
                const pinned = !!task.profile;
                return (
                  <select
                    className="rail-profile"
                    title={pinned ? "Subscription this task runs under — switch any time; the session resumes under the new account" : `Not pinned — runs under the active account (${effective || "default"}). Pick one to pin it.`}
                    value={effective}
                    disabled={busy}
                    onChange={(e) => {
                      const p = e.target.value;
                      if (!p || p === effective) return;
                      // Mid-run → resume under the new account (Continue). Idle →
                      // just pin it for the next run, no agent run.
                      const live = !!runId;
                      if (live) setLive([]);
                      client.switchProfile(taskId, p, live).then((rid) => {
                        if (rid) attachStream(rid, true);
                        else { refreshLocal(); toast.success(`Account set to ${p} for this task`); }
                      }).catch((err) => toast.error(`Couldn’t switch account: ${err}`));
                    }}
                  >
                    {!effective ? <option value="">account…</option> : null}
                    {profiles.map((p) => <option key={p} value={p}>◦ {p}{!pinned && p === effective ? " (default)" : ""}</option>)}
                  </select>
                );
              })()
            ) : null}
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
              onClick={() => { followLiveRef.current = false; setActive(s.stage_key); }}
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
                <button className="btn acc sm" onClick={async () => {
                  await client.start(taskId);
                  // Autopilot means "run end-to-end" — Start should actually drive
                  // the pipeline, not just activate the first stage and sit idle.
                  if (task.run_mode === "autopilot") {
                    followLiveRef.current = true; setLive([]);
                    client.advance(taskId).then((rid) => attachStream(rid, true)).catch((e) => toast.error(`Couldn’t start the run: ${e}`));
                  }
                  refreshAndFollow(); onChanged?.();
                }}>▶ Start task</button>
              ) : task.status !== "done" ? (
                <>
                  <StageActions client={client} taskId={taskId} stage={active} status={activeStatus} onRunLive={runStageLive} onChanged={refreshAndFollow} />
                  {active === "review" && reviewersDone.length > 0 && reviewNext ? (
                    <button className="btn acc sm" disabled={reviewerBusy} title="Approve the current reviewer and run the next one (findings accumulate)" onClick={runNextReviewer}>
                      {reviewerBusy ? "⏳ Running…" : `▶ Approve & run: ${REVIEWER_LABELS[reviewNext]}`}
                    </button>
                  ) : null}
                  {active === "review" && !reviewNext && reviewFindings > 0 ? (
                    <button className="btn acc sm" title="All reviewers ran — fix every accumulated finding in one pass, then re-review" onClick={fixFindings}>🔧 Fix all findings ({reviewFindings})</button>
                  ) : null}
                  {activeStatus === "active" ? (
                    <button className="btn sm" title="Mark this stage done and move on" onClick={async () => { await client.accept(taskId, active); refreshAndFollow(); onChanged?.(); }}>✓ Approve &amp; continue</button>
                  ) : null}
                  <button className="btn sm" title="Auto-run forward per run mode (streams live)" onClick={() => { followLiveRef.current = true; setLive([]); client.advance(taskId).then((rid) => attachStream(rid, true)).catch((e) => toast.error(`Couldn’t advance: ${e}`)); }}>▶▶ Advance</button>
                </>
              ) : null}
              {task.status === "running" ? (
                <button className="btn stop sm" title="Stop the running task" onClick={async () => { await client.stopTask(taskId); refreshAndFollow(); onChanged?.(); }}>⏹ Stop</button>
              ) : null}
              {task.repo ? (
                <button className="btn sm" title="Show the code changes (git diff)" onClick={() => setOpenFile({ path: "", mode: "diff" })}>⊟ Changes</button>
              ) : null}
              <button className="btn sm" title="The task's full history — goal, decisions, stages, cost, artifacts and changes" onClick={() => { setHistory(null); client.dossier(taskId).then((p) => setHistory(p)).catch(() => setHistory("")); }}>📖 History</button>
            </div>
          </div>
          <p className="ph-desc">{STAGE_DESC[active] ?? ""}</p>
        </header>

        <div className="pb">
          {detail.stopReason?.kind === "rate_limit" ? (
            <div className="banner banner-warn" role="status">
              ⚠ Run stopped: account{detail.stopReason.profile ? ` "${detail.stopReason.profile}"` : ""} limit reached
              {detail.stopReason.resetsAt ? ` — resets ${detail.stopReason.resetsAt}` : ""}. Switch account (above) or wait, then ▶▶ Advance.
            </div>
          ) : detail.stopReason?.kind === "cost_cap" ? (
            <div className="banner banner-warn" role="status">
              ⚠ Run stopped: cost limit ${detail.stopReason.cap}
              {detail.stopReason.spent != null ? ` (spent $${detail.stopReason.spent.toFixed(2)})` : ""}. Raise the limit in Settings or ▶▶ Advance to continue.
            </div>
          ) : null}
          <Approvals client={client} taskId={taskId} onChanged={refreshLocal} />
          <StageResult client={client} taskId={taskId} stage={active} reloadKey={reload} onFix={fixFindings} />
          <Transcript client={client} taskId={taskId} live={live} runId={runId} reconnecting={reconnecting} reloadKey={reload} onOpenFile={(p) => setOpenFile({ path: p, mode: "file" })} />
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

        <CostBar costs={costs} />
      </section>
      {openFile ? <DocPanel client={client} taskId={taskId} path={openFile.path} mode={openFile.mode} onClose={() => setOpenFile(null)} /> : null}
      {limit ? (
        <LimitModal
          profile={limit.profile}
          pct={limit.fiveHourPct}
          profiles={profiles.filter((p) => p !== limit.profile)}
          onSwitch={(p) => {
            setLimit(null);
            dismissedRef.current = "";
            setLive([]);
            client.switchProfile(taskId, p, true).then((rid) => { if (rid) attachStream(rid, true); }).catch((e) => toast.error(`Couldn’t switch account: ${e}`));
          }}
          onDismiss={() => { dismissedRef.current = limit.profile; setLimit(null); }}
        />
      ) : null}
      {history !== undefined ? (
        <Modal title={`📖 Task history — ${task.title}`} className="modal-wide" onClose={() => setHistory(undefined)}>
            <div className="modal-b" style={{ maxHeight: "70vh", overflow: "auto" }}>
              {history === null ? (
                <StateView kind="loading" />
              ) : history.trim() === "" ? (
                <div className="muted">No history recorded yet — it fills in as the agent works on this task.</div>
              ) : (
                <Markdown text={history} />
              )}
            </div>
            <div className="modal-f"><button className="btn" onClick={() => setHistory(undefined)}>Close</button></div>
        </Modal>
      ) : null}
    </div>
  );
}
