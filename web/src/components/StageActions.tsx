import { useState } from "react";
import type { LoomClient } from "../api";

// Compact per-stage controls for the chat-first task workspace. Agent stages run
// LIVE (onRunLive → streamed into the transcript); only non-agent actions
// (accept, generate, finish, brainstorm done) call the API directly.
export function StageActions({
  client,
  taskId,
  stage,
  status,
  onRunLive,
  onChanged,
}: {
  client: LoomClient;
  taskId: string;
  stage: string;
  status: string;
  onRunLive: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [connector, setConnector] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onChanged(); } finally { setBusy(false); }
  }
  const Spin = () => <span className="spin" />;

  // Agent stages: stream live into the transcript (no freeze, no auto-advance).
  if (stage === "analysis") return <button className="btn acc sm" onClick={onRunLive}>▶ Run analysis</button>;
  if (stage === "rd") return <button className="btn acc sm" onClick={onRunLive}>▶ Run R&amp;D</button>;
  if (stage === "impl") return <button className="btn acc sm" onClick={onRunLive}>▶ Run implementation</button>;
  if (stage === "review") return <button className="btn acc sm" onClick={onRunLive}>▶ Run review</button>;
  if (stage === "qa") return <button className="btn acc sm" onClick={onRunLive}>▶ Run QA</button>;
  if (stage === "spec")
    return (
      <>
        <button className="btn acc sm" onClick={onRunLive}>▶ Draft spec</button>
        <button className="btn sm" disabled={busy} onClick={() => run(() => client.specAccept(taskId))}>✓ Accept</button>
      </>
    );

  if (stage === "brainstorm")
    return <button className="btn sm" disabled={busy} onClick={() => run(() => client.brainstormDone(taskId))}>{busy ? <><Spin /> …</> : "Done → Spec"}</button>;

  if (stage === "pr")
    return (
      <>
        <label className="fld-check sm" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={connector} onChange={(e) => setConnector(e.target.checked)} /> push + PR
        </label>
        <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.prRun(taskId, { connector }))}>{busy ? <><Spin /> …</> : connector ? "▶ Create PR" : "▶ Generate PR"}</button>
      </>
    );

  if (stage === "done")
    return <button className="btn acc sm" disabled={busy || status === "done"} onClick={() => run(() => client.doneRun(taskId))}>{status === "done" ? "✓ Done" : "Finish task"}</button>;

  return null;
}
