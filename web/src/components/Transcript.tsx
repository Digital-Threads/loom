import { useEffect, useRef, useState } from "react";
import { type LoomClient, STAGE_LABELS } from "../api";
import { Markdown } from "./Markdown";
import { filePaths } from "../paths";

// The task's one live session as a single conversation: every turn (stage input
// + the agent's full output) in order, plus the live stream of the running turn.
// This is the "see everything the AI does" window the whole task shares.
export function Transcript({
  client,
  taskId,
  live,
  runId,
  reconnecting,
  reloadKey,
  onOpenFile,
}: {
  client: LoomClient;
  taskId: string;
  live: string[];
  runId: string | null;
  reconnecting?: boolean;
  reloadKey: number;
  onOpenFile: (path: string) => void;
}) {
  const [turns, setTurns] = useState<{ stage: string; input: string; output: string }[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    client.transcript(taskId).then(setTurns).catch(() => {});
  }, [client, taskId, reloadKey, runId]);

  // Tick an elapsed counter while a run is live, so the user sees it's alive
  // even during quiet stretches (the agent thinking before its next tool call).
  useEffect(() => {
    if (!runId) { setElapsed(0); return; }
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [runId]);

  // Keep the newest content in view (chat-style): the actual work is at the
  // bottom, so stick there as turns load and the live stream grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, live, runId]);

  const empty = turns.length === 0 && !(runId && live.length);

  return (
    <div className="transcript">
      <div className="transcript-h">Session log</div>
      {empty ? (
        <div className="state-empty">No activity yet — run a stage and the agent's work shows here live.</div>
      ) : null}
      {turns.map((t, i) => {
        // brainstorm signals readiness with "READY — <why>" → show a clear plaque
        // instead of a plain turn, so the user knows it's time for the spec.
        const ready = t.stage === "brainstorm" && /^\s*READY\b/.test(t.output);
        const reason = ready ? t.output.replace(/^\s*READY\s*[—:-]?\s*/, "").trim() : "";
        const files = filePaths(t.output);
        return (
          <div className="turn" key={i}>
            <div className="turn-head">
              <span className="chip">{STAGE_LABELS[t.stage] ?? t.stage}</span>
              <button className="turn-toggle" onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? "hide prompt" : "show prompt"}
              </button>
            </div>
            {open === i ? <pre className="turn-in">{t.input}</pre> : null}
            {ready ? (
              <div className="ready-note">
                <div><span className="ok-dot">✓</span> The agent has enough to write the spec.</div>
                {reason ? <div className="ready-reason">{reason}</div> : null}
                <div className="ready-reason">Use “Done → Spec” above to continue.</div>
              </div>
            ) : (
              <div className="turn-out">{t.output ? <Markdown text={t.output} /> : <span className="muted">(no output)</span>}</div>
            )}
            {files.length ? (
              <div className="turn-files">
                {files.map((p) => (
                  <button key={p} className="file-chip" title={`Open ${p}`} onClick={() => onOpenFile(p)}>📄 {p}</button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {runId ? (
        <div className={`turn turn-live ${reconnecting ? "turn-reconnect" : ""}`}>
          <div className="turn-head">
            <span className={`dotc ${reconnecting ? "wait" : "run"}`} />
            {reconnecting ? "reconnecting…" : <>working… {elapsed > 0 ? `${elapsed}s` : ""}</>}
          </div>
          <pre className="turn-out mono">{live.length ? live.join("\n") : "The agent is starting — tool activity will appear here as it works…"}</pre>
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}
