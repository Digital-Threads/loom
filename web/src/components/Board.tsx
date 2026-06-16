import { useEffect, useState, type DragEvent, type MouseEvent } from "react";
import { type LoomClient, type BoardColumn, type ProjectEntry, STAGE_LABELS } from "../api";
import { statusLabel, statusClass } from "../ui";
import { StateView } from "./StateView";
import { toast } from "../toast";

export function Board({
  client,
  onOpen,
  projects = [],
  projectFilter = "",
}: {
  client: LoomClient;
  onOpen: (id: string) => void;
  projects?: ProjectEntry[];
  projectFilter?: string; // "" = all
}) {
  const [cols, setCols] = useState<BoardColumn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    client.board().then(setCols).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <StateView kind="error" msg={`Can’t reach the core: ${err}`} />;
  if (!cols) return <StateView kind="loading" />;

  const projName = (id: string) => projects.find((p) => p.projectId === id)?.name;
  const visible = (card: { projectId: string }) => !projectFilter || card.projectId === projectFilter;

  // DnD: drag a card onto a column → move the task to that stage AND start it.
  // The drag IS the approval: the agent runs the dropped stage right away in the
  // task's one session (prior steps' context carries over). Open the task to
  // watch the live output. Then refresh the board so the card lands in its column.
  function onDrop(stageKey: string, e: DragEvent) {
    e.preventDefault();
    setOver(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    client
      .moveTask(taskId, stageKey, true)
      .then(() => client.board().then(setCols))
      .catch((er) => toast.error(`Couldn’t move the task: ${er}`));
  }

  // Trash button on a card → confirm, delete the task (and all its rows), then
  // refresh the board so the card drops out. stopPropagation keeps the click
  // from also opening the task.
  function onDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (deleting.has(id)) return; // a request is already in flight for this card
    if (!window.confirm("Delete this task? This can’t be undone.")) return;
    setDeleting((s) => new Set(s).add(id));
    client
      .deleteTask(id)
      .catch((er: Error) => {
        // 404 = already gone (e.g. a double request) → treat as success, no toast.
        if (!/→ 404$/.test(er.message)) throw er;
      })
      .then(() => client.board().then(setCols))
      .catch((er) => toast.error(`Couldn’t delete the task: ${er}`))
      .finally(() => setDeleting((s) => { const n = new Set(s); n.delete(id); return n; }));
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
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                  onClick={() => onOpen(card.id)}
                >
                  <button
                    className="card-del"
                    title="Delete task"
                    aria-label="Delete task"
                    disabled={deleting.has(card.id)}
                    onClick={(e) => onDelete(card.id, e)}
                  >
                    🗑
                  </button>
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
                </div>
              ))
            ) : (
              <div className="skip">—</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
