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
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setRes(await client.analysisRun(taskId)); onChanged?.(); } finally { setBusy(false); }
  }
  return (
    <div>
      <button className="btn acc" disabled={busy} onClick={run}>▶ Run analysis</button>
      {res ? (
        <div className="kv" style={{ marginTop: 12 }}>
          <b>{res.class}</b><span>route: {res.route.join(" → ")}</span>
        </div>
      ) : <div className="muted" style={{ marginTop: 12 }}>Classify the task and propose its route.</div>}
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
      <div className="chat" style={{ maxHeight: 280, overflow: "auto" }}>
        {msgs.length ? msgs.map((m) => (
          <div className={`kv ${m.role === "agent" ? "" : "warn"}`} key={m.id}><b>{m.role}</b><span>{m.content}</span></div>
        )) : <div className="muted">Start the brainstorm — ask the agent for the first question.</div>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input className="inp" value={input} placeholder="your answer…" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) send(input.trim()); }} />
        <button className="btn" disabled={busy} onClick={() => send(msgs.length ? input.trim() || undefined : undefined)}>
          {msgs.length ? "Send" : "Ask"}
        </button>
        <button className="btn acc" disabled={busy} onClick={done}>Done → spec</button>
      </div>
      {summary ? <div className="kv" style={{ marginTop: 8 }}><b>summary</b><span>{summary.content}</span></div> : null}
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
        <button className="btn acc" disabled={busy} onClick={() => act(() => client.specDraft(taskId))}>Draft</button>
        {spec ? <button className="btn" disabled={busy} onClick={() => act(() => client.specAccept(taskId))}>Accept</button> : null}
      </div>
      {spec ? (
        <>
          <div className="grp" style={{ marginTop: 10 }}>spec-md v{spec.version} · {spec.status}</div>
          <pre className="b" style={{ whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto" }}>{spec.content}</pre>
          <div className="row" style={{ gap: 8 }}>
            <input className="inp" placeholder="return with comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn" disabled={busy || !comment.trim()} onClick={() => { act(() => client.specReturn(taskId, comment.trim())); setComment(""); }}>Return</button>
          </div>
        </>
      ) : <div className="muted" style={{ marginTop: 10 }}>No spec yet — draft from the brainstorm summary.</div>}
    </div>
  );
}
