import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent, AgentPerf, FailureReason } from "../api";

// L9.5 — unified timeline (event stream) + board totals + agent performance.
export function Timeline({ client }: { client: LoomClient }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [board, setBoard] = useState<{ used: number; saved: number } | null>(null);
  const [agents, setAgents] = useState<AgentPerf[]>([]);
  const [failures, setFailures] = useState<FailureReason[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.timeline().then(setEvents).catch((e) => setErr(String(e)));
    client.boardMetrics().then(setBoard).catch(() => {});
    client.agentMetrics().then((m) => { setAgents(m.agents); setFailures(m.failures); }).catch(() => {});
  }, [client]);

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;
  if (!events) return <div className="empty">Loading…</div>;

  return (
    <div className="panel">
      {board ? (
        <div className="row" style={{ gap: 24 }}>
          <div><div className="grp">Spent</div><div className="big">{board.used.toLocaleString()}</div></div>
          <div><div className="grp">Saved ≈</div><div className="big">{board.saved.toLocaleString()}</div></div>
        </div>
      ) : null}

      {agents.length ? (
        <>
          <h2 style={{ marginTop: 20 }}>Agent performance</h2>
          <table className="tbl">
            <thead><tr><th>Profile</th><th>Runs</th><th>Failures</th><th>Duration ms</th></tr></thead>
            <tbody>{agents.map((a) => (
              <tr key={a.profile}><td>{a.profile}</td><td>{a.runs}</td><td>{a.failures}</td><td>{a.durationMs}</td></tr>
            ))}</tbody>
          </table>
        </>
      ) : null}

      {failures.length ? (
        <>
          <h2 style={{ marginTop: 20 }}>Failure reasons</h2>
          {failures.map((fr, i) => <div className="kv" key={i}><b>{fr.count}×</b><span>{fr.message}</span></div>)}
        </>
      ) : null}

      <h2 style={{ marginTop: 20 }}>Timeline <span className="n">{events.length}</span></h2>
      {events.length === 0 ? (
        <div className="empty">No events yet — run a task to see its trail.</div>
      ) : (
        events.map((e, i) => (
          <div className={`kv ${e.severity === "error" ? "warn" : ""}`} key={i}>
            <b>{e.type}</b>
            <span>
              {e.source}{e.profileId ? ` · ${e.profileId}` : ""}{e.message ? ` · ${e.message}` : ""}
              {e.metrics ? ` · ${Object.entries(e.metrics).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
