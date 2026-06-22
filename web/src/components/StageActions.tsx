import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { toast } from "../toast";
import { useT } from "../i18n";

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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [connector, setConnector] = useState(false);
  // Push availability (just an origin remote) — we push the branch and hand back
  // a host PR/MR link, so "push + PR link" only needs a remote, no gh.
  const [conn, setConn] = useState<{ remote: boolean; repo: boolean } | null>(null);
  useEffect(() => {
    if (stage !== "pr") return;
    client.prConnector(taskId).then(setConn).catch(() => setConn(null));
  }, [client, taskId, stage]);
  const connReady = !!conn && conn.repo && conn.remote;
  const connReason = !conn
    ? ""
    : !conn.repo ? t("stageActions.noRepo")
    : !conn.remote ? t("stageActions.noRemote")
    : "";
  const [returning, setReturning] = useState(false);
  const [comment, setComment] = useState("");
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onChanged(); }
    catch (e) { toast.error(`Action failed: ${e}`); }
    finally { setBusy(false); }
  }
  const Spin = () => <span className="spin" />;

  // Agent stages: stream live into the transcript (no freeze, no auto-advance).
  if (stage === "analysis") return <button className="btn acc sm" onClick={onRunLive}>▶ {t("stageActions.runAnalysis")}</button>;
  if (stage === "rd") return <button className="btn acc sm" onClick={onRunLive}>▶ {t("stageActions.runRd")}</button>;
  if (stage === "impl") return <button className="btn acc sm" onClick={onRunLive}>▶ {t("stageActions.runImpl")}</button>;
  if (stage === "review") return <button className="btn acc sm" onClick={onRunLive}>▶ {t("stageActions.runReview")}</button>;
  if (stage === "qa") return <button className="btn acc sm" onClick={onRunLive}>▶ {t("stageActions.runQa")}</button>;
  if (stage === "spec")
    return (
      <>
        <button className="btn acc sm" onClick={onRunLive}>▶ {t("stageActions.draftSpec")}</button>
        <button className="btn sm" disabled={busy} onClick={() => run(() => client.specAccept(taskId))}>✓ {t("stageActions.accept")}</button>
        <button className="btn sm" disabled={busy} onClick={() => setReturning((v) => !v)}>↩ {t("action.changes")}</button>
        {returning ? (
          <span className="spec-return">
            <input
              value={comment}
              autoFocus
              placeholder={t("stageActions.specChangePlaceholder")}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && comment.trim()) run(async () => { await client.specReturn(taskId, comment.trim()); setComment(""); setReturning(false); }); }}
            />
            <button className="btn acc sm" disabled={busy || !comment.trim()} onClick={() => run(async () => { await client.specReturn(taskId, comment.trim()); setComment(""); setReturning(false); })}>{busy ? <><Spin /> …</> : t("action.send")}</button>
          </span>
        ) : null}
      </>
    );

  if (stage === "brainstorm")
    return <button className="btn sm" disabled={busy} onClick={() => run(() => client.brainstormDone(taskId))}>{busy ? <><Spin /> …</> : t("stageActions.doneToSpec")}</button>;

  if (stage === "pr") {
    const useConnector = connector && connReady;
    return (
      <>
        <label className="fld-check sm" style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={connReady ? t("stageActions.pushPrTitle") : `${t("stageActions.pushUnavailable")}: ${connReason}`}>
          <input type="checkbox" checked={useConnector} disabled={!connReady} onChange={(e) => setConnector(e.target.checked)} /> {t("stageActions.pushPrLink")}
        </label>
        {conn && !connReady ? <span className="muted sm" title={connReason}>⚠ {t("stageActions.cantPush")} — {connReason}</span> : null}
        <button className="btn acc sm" disabled={busy} onClick={() => run(() => client.prRun(taskId, { connector: useConnector }))}>{busy ? <><Spin /> …</> : useConnector ? `▶ ${t("stageActions.pushAndPr")}` : `▶ ${t("stageActions.generatePr")}`}</button>
      </>
    );
  }

  if (stage === "done")
    return <button className="btn acc sm" disabled={busy || status === "done"} onClick={() => run(() => client.doneRun(taskId))}>{status === "done" ? `✓ ${t("stageActions.done")}` : t("stageActions.finishTask")}</button>;

  return null;
}
