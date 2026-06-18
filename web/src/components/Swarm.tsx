import type { LoomClient } from "../api";

// Swarm module — @digital-threads/loom-swarm. A stateless multi-agent utility
// (concurrent runs + consensus); it has no persistent runtime state, so this is
// a capability/config page rather than a live dashboard.
export function Swarm(_props: { client: LoomClient }) {
  const caps = [
    { k: "runConcurrent", d: "Runs one task across several agents in parallel and collects the outcomes." },
    { k: "majorityVote", d: "Consensus over results — takes the majority answer." },
    { k: "successes", d: "Picks the successful outcomes from a set of attempts." },
  ];
  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Multi-agent coordinator. Standalone package <code>@digital-threads/loom-swarm</code>.
      </p>

      <div className="kv"><b>Default attempts</b><span><span className="chip">attempts: 3</span></span></div>

      <h2>Capabilities</h2>
      <ul className="finding-list">
        {caps.map((c) => (
          <li key={c.k} className="finding sev-info">
            <span className="finding-sev">{c.k}</span>
            <span className="finding-msg">{c.d}</span>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
        Stateless utility — no live state or dashboard: swarm runs ephemerally inside a task. A panel will appear once swarm grows background runs.
      </p>
    </div>
  );
}
