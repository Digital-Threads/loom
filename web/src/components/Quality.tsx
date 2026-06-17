import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";

// Quality module — @digital-threads/loom-quality. Describes the review/QA
// pipeline and shows the live QA check configuration.
export function Quality({ client }: { client: LoomClient }) {
  const [qa, setQa] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { client.flowConfig("qa").then(setQa).catch((e) => setErr(String(e))); }, [client]);

  if (err) return <StateView kind="error" msg={err} />;

  const reviewers = [
    { key: "self", label: "Своё ревью", desc: "Сессия задачи ревьюит свои изменения (видит код, помнит что делала)." },
    { key: "ralph", label: "Ralph-loop", desc: "Итеративное ревью, до 3 проходов." },
    { key: "adversarial", label: "Adversarial", desc: "Скилл /adversarial-review — пытается сломать решение." },
  ];

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        AI-ревью кода + прогон проверок. Standalone-пакет <code>@digital-threads/loom-quality</code>.
      </p>
      <h2>Конвейер ревью (накопление находок → один фикс)</h2>
      <ul className="finding-list">
        {reviewers.map((r) => (
          <li key={r.key} className="finding sev-info">
            <span className="finding-sev">{r.label}</span>
            <span className="finding-msg">{r.desc}</span>
          </li>
        ))}
      </ul>
      <h2>QA-проверки</h2>
      {!qa ? <StateView kind="loading" /> : qa.length === 0 ? (
        <span className="muted">Не настроены.</span>
      ) : (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {qa.map((p) => <span key={p} className="chip">{p}</span>)}
        </div>
      )}
    </div>
  );
}
