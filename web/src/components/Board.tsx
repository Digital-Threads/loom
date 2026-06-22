import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import { type LoomClient, type BoardColumn, type ProjectEntry, STAGE_LABELS } from "../api";
import { statusLabel, statusClass } from "../ui";
import { StateView } from "./StateView";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { toast } from "../toast";
import { useT } from "../i18n";

export function Board({
  client,
  onOpen,
  onNew,
  projects = [],
  projectFilter = "",
}: {
  client: LoomClient;
  onOpen: (id: string) => void;
  onNew?: () => void; // open the "new task" flow from the board's empty state
  projects?: ProjectEntry[];
  projectFilter?: string; // "" = all
}) {
  const t = useT();
  const [cols, setCols] = useState<BoardColumn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ id: string; title: string } | null>(null);
  const [stopping, setStopping] = useState<Set<string>>(new Set());

  useEffect(() => {
    client.board().then(setCols).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <StateView kind="error" msg={`${t("board.err.unreachable")}: ${err}`} />;
  if (!cols) return <StateView kind="loading" />;

  const projName = (id: string) => projects.find((p) => p.projectId === id)?.name;
  const visible = (card: { projectId: string }) => !projectFilter || card.projectId === projectFilter;

  // Whole-board empty state: with no task in any column there is nothing to drag,
  // so a row of empty columns reads as broken. Show one clear empty state instead.
  // Distinguish "no tasks at all" from "none under the current project filter".
  if (!cols.some((c) => c.cards.some(visible))) {
    const anyTask = cols.some((c) => c.cards.length > 0);
    return (
      <StateView
        kind="empty"
        msg={anyTask ? t("board.empty.project") : t("board.empty.all")}
        action={onNew ? <button className="btn acc" onClick={onNew}>{t("board.newTask")}</button> : undefined}
      />
    );
  }

  // DnD: drag a card onto a column → move the task to that stage AND start it.
  // The drag IS the approval: the agent runs the dropped stage right away in the
  // task's one session (prior steps' context carries over). Open the task to
  // watch the live output. Then refresh the board so the card lands in its column.
  // Move a card to a stage and run it (shared by drag-drop and the keyboard
  // "Move to stage" select, so both paths behave identically).
  function moveCard(taskId: string, stageKey: string) {
    client
      .moveTask(taskId, stageKey, true)
      .then(() => client.board().then(setCols))
      .catch((er) => toast.error(`${t("board.err.move")}: ${er}`));
  }

  function onDrop(stageKey: string, e: DragEvent) {
    e.preventDefault();
    setOver(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    moveCard(taskId, stageKey);
  }

  // Trash button on a card → open an in-app confirm modal (styled like the other
  // overlays) carrying the task's id + title. stopPropagation keeps the click
  // from also opening the task; the real delete runs from the modal.
  function askDelete(id: string, title: string, e: MouseEvent) {
    e.stopPropagation();
    if (deleting.has(id)) return; // a request is already in flight for this card
    setConfirm({ id, title });
  }

  // Delete the task (and all its rows), then refresh the board so the card drops
  // out. Called once the user confirms in the modal.
  function doDelete(id: string) {
    setConfirm(null);
    setDeleting((s) => new Set(s).add(id));
    client
      .deleteTask(id)
      .catch((er: Error) => {
        // 404 = already gone (e.g. a double request) → treat as success, no toast.
        if (!/→ 404$/.test(er.message)) throw er;
      })
      .then(() => client.board().then(setCols))
      .catch((er) => toast.error(`${t("board.err.delete")}: ${er}`))
      .finally(() => setDeleting((s) => { const n = new Set(s); n.delete(id); return n; }));
  }

  // Stop button on a running card → stop the task's active run + live session,
  // then refresh the board. stopPropagation keeps the click from opening the task.
  function onStop(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (stopping.has(id)) return; // a request is already in flight for this card
    setStopping((s) => new Set(s).add(id));
    client
      .stopTask(id)
      .then(() => client.board().then(setCols))
      .catch((er) => toast.error(`${t("board.err.stop")}: ${er}`))
      .finally(() => setStopping((s) => { const n = new Set(s); n.delete(id); return n; }));
  }

  return (
    <div className="board">
      {cols.map((col) => (
        <div
          className={`col ${over === col.stageKey ? "col-over" : ""}`}
          key={col.stageKey}
          onDragOver={(e) => { e.preventDefault(); if (over !== col.stageKey) setOver(col.stageKey); }}
          onDragLeave={() => setOver((o) => (o === col.stageKey ? null : o))}
          onDrop={(e) => onDrop(col.stageKey, e)}
        >
          <h2>
            {STAGE_LABELS[col.stageKey] ?? col.stageKey}
            <span className="n">{col.cards.filter(visible).length}</span>
          </h2>
          <div className="stack">
            {col.cards.filter(visible).length ? (
              col.cards.filter(visible).map((card) => (
                <div
                  className={`card ${statusClass(card.status)}`}
                  key={card.id}
                  draggable
                  role="button"
                  tabIndex={0}
                  aria-label={`${t("board.openTask")}: ${card.title}`}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                  onClick={() => onOpen(card.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpen(card.id); }}
                >
                  <button
                    className="card-del"
                    title={t("board.deleteTask")}
                    aria-label={t("board.deleteTask")}
                    disabled={deleting.has(card.id)}
                    onClick={(e) => askDelete(card.id, card.title, e)}
                  >
                    🗑
                  </button>
                  {card.status === "running" ? (
                    <button
                      className="card-stop"
                      title={t("board.stopTask")}
                      aria-label={t("board.stopTask")}
                      disabled={stopping.has(card.id)}
                      onClick={(e) => onStop(card.id, e)}
                    >
                      ⏹
                    </button>
                  ) : null}
                  <div className="t">{card.title}</div>
                  <div className="meta">
                    <span className={`chip ${statusClass(card.status)}`}>
                      <span className="dotc" />
                      {statusLabel(card.status)}
                    </span>
                    {projects.length > 1 && projName(card.projectId) ? (
                      <span className="chip proj">{projName(card.projectId)}</span>
                    ) : null}
                  </div>
                  <Select
                    block
                    size="sm"
                    wrapClassName="card-move"
                    aria-label={t("board.moveToStage")}
                    value=""
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => { e.stopPropagation(); moveCard(card.id, e.target.value); }}
                  >
                    <option value="" disabled>{t("board.move")}</option>
                    {cols.map((c) => (
                      <option key={c.stageKey} value={c.stageKey}>{STAGE_LABELS[c.stageKey] ?? c.stageKey}</option>
                    ))}
                  </Select>
                </div>
              ))
            ) : (
              <div className="dropzone">{t("board.dropHere")}</div>
            )}
          </div>
        </div>
      ))}
      {confirm ? (
        <Modal title={t("board.deleteTask")} onClose={() => setConfirm(null)}>
          <div className="modal-b">{t("board.deleteConfirmPre")} "{confirm.title}"? {t("board.deleteConfirmPost")}</div>
          <div className="modal-f">
            <button className="btn" onClick={() => setConfirm(null)}>{t("action.cancel")}</button>
            <button className="btn acc" onClick={() => doDelete(confirm.id)}>{t("action.delete")}</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
