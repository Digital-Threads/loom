import type { LoomClient } from "../api";

// Swarm module — @digital-threads/loom-swarm. Multi-agent coordination. v1 is
// thin (no live state yet), so this is an info page describing the capability.
export function Swarm(_props: { client: LoomClient }) {
  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Координатор мульти-агента. Standalone-пакет <code>@digital-threads/loom-swarm</code>.
      </p>
      <h2>Что делает</h2>
      <ul className="finding-list">
        <li className="finding sev-info">
          <span className="finding-sev">coordinator</span>
          <span className="finding-msg">Распределяет одну задачу между несколькими агентами и собирает результаты.</span>
        </li>
        <li className="finding sev-info">
          <span className="finding-sev">v1</span>
          <span className="finding-msg">Пока тонкий: живого состояния/панели мониторинга нет — появится по мере развития.</span>
        </li>
      </ul>
    </div>
  );
}
