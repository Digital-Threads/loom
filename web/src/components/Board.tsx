import { useEffect, useState, type DragEvent } from "react";
import { type LoomClient, type BoardColumn, STAGE_LABELS } from "../api";
import { statusLabel, statusClass } from "../ui";

export function Board({ client, onOpen }: { client: LoomClient; onOpen: (id: string) => void }) {
  const [cols, setCols] = useState<BoardColumn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.board().then(setCols).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;
  if (!cols) return <div className="empty">Loading…</div>;

  // DnD: drag a card onto a column → move the task to that stage and refresh.
  // Repositions only (no run started); start the stage from the task view.
  function onDrop(stageKey: string, e: DragEvent) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;
    client.moveTask(taskId, stageKey).then(() => client.board().then(setCols)).catch(() => {});
  }

  return (
    <div className="board">
      {cols.map((col) => (
        <div
          className="col"
          key={col.stageKey}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(col.stageKey, e)}
        >
          <h2>
            {STAGE_LABELS[col.stageKey] ?? col.stageKey}
            <span className="n">{col.cards.length}</span>
          </h2>
          <div className="stack">
            {col.cards.length ? (
              col.cards.map((card) => (
                <div
                  className={`card ${statusClass(card.status)}`}
                  key={card.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                  onClick={() => onOpen(card.id)}
                >
                  <div className="t">{card.title}</div>
                  <div className="meta">
                    <span className={`chip ${statusClass(card.status)}`}>
                      <span className="dotc" />
                      {statusLabel(card.status)}
                    </span>
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
