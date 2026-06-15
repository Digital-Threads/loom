import { useState } from "react";
import type { LoomClient } from "../api";

// Compact per-stage controls for the chat-first task workspace. The OUTPUT of
// every stage shows in the session transcript; this only renders the actions.
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
  onRunLive: () => void; // start a streaming run of the current stage
  onChanged: () => void; // refresh task + transcript
}) {
  const [busy, setBusy] = useState(false);
  const [connector, setConnector] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onChanged(); } finally { setBusy(false); }
  }
  const Spin = () => <span className="spin" />;

  if (stage === "analysis")
    return <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.analysisRun(taskId))}>{busy ? <><Spin /> Analyzing…</> : "▶ Run analysis"}</button>;

  if (stage === "brainstorm")
    return <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.brainstormDone(taskId))}>{busy ? <><Spin /> …</> : "Done → Spec"}</button>;

  if (stage === "spec")
    return (
      <>
        <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.specDraft(taskId))}>{busy ? <><Spin /> Drafting…</> : "▶ Draft spec"}</button>
        <button className="btn sm" disabled={busy} onClick={() => run(() => client.specAccept(taskId))}>✓ Accept spec</button>
      </>
    );

  if (stage === "rd" || stage === "impl")
    return <button className="btn acc sm" disabled={busy} onClick={onRunLive}>▶ Run {stage === "rd" ? "R&D" : "implementation"}</button>;

  if (stage === "review")
    return <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.reviewRun(taskId))}>{busy ? <><Spin /> Reviewing…</> : "▶ Run review"}</button>;

  if (stage === "qa")
    return <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.qaRun(taskId))}>{busy ? <><Spin /> Checking…</> : "▶ Run QA"}</button>;

  if (stage === "pr")
    return (
      <>
        <label className="fld-check sm" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={connector} onChange={(e) => setConnector(e.target.checked)} /> push + open PR
        </label>
        <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.prRun(taskId, { connector }))}>{busy ? <><Spin /> …</> : connector ? "▶ Create PR" : "▶ Generate PR"}</button>
      </>
    );

  if (stage === "done")
    return <button className="btn acc sm" disabled={busy || status === "done"} onClick={() => run(() => client.doneRun(taskId))}>{status === "done" ? "✓ Done" : "Finish task"}</button>;

  return null;
}
