import { useEffect, useState } from "react";
import type { LoomClient, ChatMessage, Artifact } from "../api";

// L12.6 — UI for the dialog stages: Analysis (classify + route), Brainstorm
// (chat, one question at a time), Spec (draft / return-with-comment / accept).
export function StageDialog({
  client,
  taskId,
  stage,
  onChanged,
}: {
  client: LoomClient;
  taskId: string;
  stage: string;
  onChanged?: () => void;
}) {
  if (stage === "analysis") return <Analysis client={client} taskId={taskId} onChanged={onChanged} />;
  if (stage === "brainstorm") return <Brainstorm client={client} taskId={taskId} />;
  if (stage === "spec") return <Spec client={client} taskId={taskId} onChanged={onChanged} />;
  return null;
}

function Analysis({ client, taskId, onChanged }: { client: LoomClient; taskId: string; onChanged?: () => void }) {
  const [res, setRes] = useState<{ class: string; route: string[] } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.analysisGet(taskId).then((g) => { setRes(g.result); setText(g.text); }).catch(() => {}); }, [client, taskId]);
  async function run() {
    setBusy(true);
    try { await client.analysisRun(taskId); const g = await client.analysisGet(taskId); setRes(g.result); setText(g.text); onChanged?.(); } finally { setBusy(false); }
  }
  return (
    <div>
      <button className="btn acc" disabled={busy} onClick={run}>{busy ? <><span className="spin" /> Analyzing…</> : res ? "↻ Re-run analysis" : "▶ Run analysis"}</button>
      {busy ? (
        <div className="run-note"><span className="spin" /> Reading the task and the codebase…</div>
      ) : text ? (
        <div className="result-card">
          <div className="result-head"><span className="ok-dot" /> Analysis{res ? <> — classified as <b>{res.class}</b></> : null}</div>
          <div className="doc">{text}</div>
          {res && res.route.length ? (
            <div className="route">
              {res.route.map((s, i) => (
                <span key={s} className="route-step">{s}{i < res.route.length - 1 ? <span className="route-arrow">→</span> : null}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="state-empty">Not analyzed yet — run it to classify the task and propose its route.</div>
      )}
    </div>
  );
}

function Brainstorm({ client, taskId }: { client: LoomClient; taskId: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Artifact | null>(null);

  useEffect(() => { client.brainstormMessages(taskId).then(setMsgs).catch(() => {}); }, [client, taskId]);

  async function send(message?: string) {
    setBusy(true);
    try { await client.brainstormMessage(taskId, message); setInput(""); setMsgs(await client.brainstormMessages(taskId)); }
    finally { setBusy(false); }
  }
  async function done() {
    setBusy(true);
    try { setSummary(await client.brainstormDone(taskId)); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="chat">
        {msgs.length ? msgs.map((m) => (
          <div className={`bubble ${m.role === "agent" ? "bubble-agent" : "bubble-user"}`} key={m.id}>
            <div className="bubble-role">{m.role === "agent" ? "Agent" : "You"}</div>
            <div className="bubble-text">{m.content}</div>
          </div>
        )) : <div className="state-empty">The agent will ask clarifying questions one at a time. Start when you're ready.</div>}
        {busy ? <div className="run-note"><span className="spin" /> Agent is thinking…</div> : null}
      </div>
      {summary ? (
        <div className="result-card" style={{ marginTop: 12 }}>
          <div className="result-head"><span className="ok-dot" /> Brainstorm summary</div>
          <div className="doc">{summary.content}</div>
        </div>
      ) : (
        <div className="chat-input">
          <input value={input} placeholder={msgs.length ? "your answer…" : "press Start — the agent asks first"} disabled={busy || !msgs.length}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) send(input.trim()); }} />
          <button className="btn" disabled={busy} onClick={() => send(msgs.length ? input.trim() || undefined : undefined)}>
            {msgs.length ? "Send" : "▶ Start brainstorm"}
          </button>
          {msgs.length ? <button className="btn acc" disabled={busy} onClick={done}>Done → Spec</button> : null}
        </div>
      )}
    </div>
  );
}

function Spec({ client, taskId, onChanged }: { client: LoomClient; taskId: string; onChanged?: () => void }) {
  const [spec, setSpec] = useState<Artifact | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.specGet(taskId).then(setSpec).catch(() => {}); }, [client, taskId]);

  async function act(fn: () => Promise<Artifact>) {
    setBusy(true);
    try { setSpec(await fn()); onChanged?.(); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn acc" disabled={busy} onClick={() => act(() => client.specDraft(taskId))}>{busy ? <><span className="spin" /> Drafting…</> : spec ? "↻ Re-draft" : "▶ Draft spec"}</button>
        {spec ? <button className="btn" disabled={busy} onClick={() => act(() => client.specAccept(taskId))}>✓ Accept spec</button> : null}
      </div>
      {spec ? (
        <div className="result-card" style={{ marginTop: 12 }}>
          <div className="card-head"><span>SDD <span className="chip">v{spec.version}</span> <span className={`badge ${spec.status === "accepted" ? "badge-ok" : "badge-warn"}`}>{spec.status}</span></span></div>
          <pre className="doc">{spec.content}</pre>
          <div className="chat-input">
            <input placeholder="return with a comment for the agent to revise…" value={comment} disabled={busy} onChange={(e) => setComment(e.target.value)} />
            <button className="btn" disabled={busy || !comment.trim()} onClick={() => { act(() => client.specReturn(taskId, comment.trim())); setComment(""); }}>Return for changes</button>
          </div>
        </div>
      ) : <div className="state-empty">No spec yet — draft it from the brainstorm summary.</div>}
    </div>
  );
}
