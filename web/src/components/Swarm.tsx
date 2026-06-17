import type { LoomClient } from "../api";

// Swarm module — @digital-threads/loom-swarm. A stateless multi-agent utility
// (concurrent runs + consensus); it has no persistent runtime state, so this is
// a capability/config page rather than a live dashboard.
export function Swarm(_props: { client: LoomClient }) {
  const caps = [
    { k: "runConcurrent", d: "Запускает одну задачу несколькими агентами параллельно и собирает исходы." },
    { k: "majorityVote", d: "Консенсус по результатам — берёт ответ большинства." },
    { k: "successes", d: "Отбирает успешные исходы из набора попыток." },
  ];
  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Координатор мульти-агента. Standalone-пакет <code>@digital-threads/loom-swarm</code>.
      </p>

      <div className="kv"><b>Попыток по умолчанию</b><span><span className="chip">attempts: 3</span></span></div>

      <h2>Что умеет</h2>
      <ul className="finding-list">
        {caps.map((c) => (
          <li key={c.k} className="finding sev-info">
            <span className="finding-sev">{c.k}</span>
            <span className="finding-msg">{c.d}</span>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: 12 }}>
        Stateless-утилита — живого состояния/панели мониторинга нет: swarm работает эфемерно внутри задачи.
        Панель появится, когда swarm дорастёт до фоновых прогонов.
      </p>
    </div>
  );
}
