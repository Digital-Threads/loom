import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// Quality module — @digital-threads/loom-quality. The review pipeline (fixed:
// self/ralph/adversarial) plus the editable QA checks (persisted via flow-config).
const QA_OPTIONS = [
  { key: "tests", label: "tests", desc: "репозиторный test-скрипт" },
  { key: "build", label: "build", desc: "репозиторный build-скрипт" },
  { key: "browser", label: "browser", desc: "E2E через canary-коннектор" },
];
const REVIEWERS = [
  { key: "self", label: "Своё ревью", desc: "Сессия задачи ревьюит свои изменения." },
  { key: "ralph", label: "Ralph-loop", desc: "Итеративное ревью, до 3 проходов." },
  { key: "adversarial", label: "Adversarial", desc: "/adversarial-review — пытается сломать решение." },
];

export function Quality({ client }: { client: LoomClient }) {
  const [qa, setQa] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { client.flowConfig("qa").then(setQa).catch((e) => setErr(String(e))); }, [client]);

  function toggle(key: string) {
    if (!qa) return;
    const next = qa.includes(key) ? qa.filter((k) => k !== key) : [...qa, key];
    setQa(next);
    setBusy(true);
    client.saveFlowConfig("qa", next).then(() => toast.success("QA сохранён")).catch((e) => toast.error(`Не сохранилось: ${e}`)).finally(() => setBusy(false));
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        AI-ревью кода + прогон проверок. Standalone-пакет <code>@digital-threads/loom-quality</code>.
      </p>

      <h2>Конвейер ревью <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(фиксирован, накопление находок → один фикс)</span></h2>
      <ul className="finding-list">
        {REVIEWERS.map((r) => (
          <li key={r.key} className="finding sev-info">
            <span className="finding-sev">{r.label}</span>
            <span className="finding-msg">{r.desc}</span>
          </li>
        ))}
      </ul>

      <h2>QA-проверки <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(кликни чтобы вкл/выкл)</span></h2>
      {!qa ? <StateView kind="loading" /> : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {QA_OPTIONS.map((o) => {
            const on = qa.includes(o.key);
            return (
              <button key={o.key} className={`btn sm ${on ? "acc" : ""}`} disabled={busy} title={o.desc} onClick={() => toggle(o.key)}>
                {on ? "✓ " : "○ "}{o.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Применяется к стадии QA новых прогонов. Пусто → дефолт (tests + build).</p>
    </div>
  );
}
