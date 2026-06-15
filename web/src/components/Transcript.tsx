import { useEffect, useState } from "react";
import { type LoomClient, STAGE_LABELS } from "../api";

// The task's one live session as a single conversation: every turn (stage input
// + the agent's full output) in order, plus the live stream of the running turn.
// This is the "see everything the AI does" window the whole task shares.
export function Transcript({
  client,
  taskId,
  live,
  runId,
  reloadKey,
}: {
  client: LoomClient;
  taskId: string;
  live: string[];
  runId: string | null;
  reloadKey: number;
}) {
  const [turns, setTurns] = useState<{ stage: string; input: string; output: string }[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    client.transcript(taskId).then(setTurns).catch(() => {});
  }, [client, taskId, reloadKey, runId]);

  const empty = turns.length === 0 && !(runId && live.length);

  return (
    <div className="transcript">
      <div className="transcript-h">Session log</div>
      {empty ? (
        <div className="state-empty">No activity yet — run a stage and the agent's work shows here live.</div>
      ) : null}
      {turns.map((t, i) => (
        <div className="turn" key={i}>
          <div className="turn-head">
            <span className="chip">{STAGE_LABELS[t.stage] ?? t.stage}</span>
            <button className="turn-toggle" onClick={() => setOpen(open === i ? null : i)}>
              {open === i ? "hide prompt" : "show prompt"}
            </button>
          </div>
          {open === i ? <pre className="turn-in">{t.input}</pre> : null}
          <div className="turn-out">{t.output || <span className="muted">(no output)</span>}</div>
        </div>
      ))}
      {runId ? (
        <div className="turn turn-live">
          <div className="turn-head"><span className="dotc run" /> running…</div>
          <pre className="turn-out mono">{live.length ? live.join("\n") : "starting…"}</pre>
        </div>
      ) : null}
    </div>
  );
}
