import { useEffect, useState } from "react";
import { type LoomClient, type BoardColumn, STAGE_LABELS } from "../api";
import { statusLabel, statusClass } from "../ui";

export function Board({ client, onOpen }: { client: LoomClient; onOpen: (id: string) => void }) {
  const [cols, setCols] = useState<BoardColumn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.board().then(setCols).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <div className="empty">Нет связи с ядром: {err}</div>;
  if (!cols) return <div className="empty">Загрузка…</div>;

  return (
    <div className="board">
      {cols.map((col) => (
        <div className="col" key={col.stageKey}>
          <h2>
            {STAGE_LABELS[col.stageKey] ?? col.stageKey}
            <span className="n">{col.cards.length}</span>
          </h2>
          <div className="stack">
            {col.cards.length ? (
              col.cards.map((card) => (
                <div className={`card ${statusClass(card.status)}`} key={card.id} onClick={() => onOpen(card.id)}>
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
