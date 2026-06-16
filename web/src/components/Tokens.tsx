import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData } from "../api";
import { StateView } from "./StateView";

// F1.3 — token-pilot usage: per-session table + spent/saved totals (saved is an
// estimate, marked honestly) + recent token events.
export function Tokens({ client }: { client: LoomClient }) {
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.workspace().then(setWs).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!ws) return <StateView kind="loading" />;
  if (ws.tokens.length === 0)
    return <StateView kind="empty" msg="No token usage recorded yet." />;

  const used = ws.tokens.reduce((a, t) => a + t.used, 0);
  const saved = ws.tokens.reduce((a, t) => a + t.saved, 0);
  const savedPct = used + saved > 0 ? Math.round((saved / (used + saved)) * 100) : 0;
  const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
  const rowPct = (u: number, s: number) => (u + s > 0 ? Math.round((s / (u + s)) * 100) : 0);

  return (
    <div className="panel">
      <div className="stat-row">
        <div className="stat"><div className="grp">Tokens used</div><div className="big">{used.toLocaleString()}</div></div>
        <div className="stat">
          <div className="grp">Saved by token-pilot</div>
          <div className="big">{saved.toLocaleString()} {saved > 0 ? <span className="stat-sub">≈{savedPct}%</span> : null}</div>
        </div>
        <div className="stat"><div className="grp">Sessions</div><div className="big">{ws.tokens.length}{ws.tokenEvents.length ? <span className="stat-sub">{ws.tokenEvents.length} events</span> : null}</div></div>
      </div>
      <h2 style={{ marginTop: 24 }}>By session</h2>
      <table className="tbl">
        <thead><tr><th>Session</th><th className="num">Used</th><th className="num">Saved ≈</th><th className="num">Saved %</th></tr></thead>
        <tbody>
          {ws.tokens.map((t) => (
            <tr key={t.sessionId}>
              <td className="crumb" title={t.sessionId}>{shortId(t.sessionId)}</td>
              <td className="num">{t.used.toLocaleString()}</td>
              <td className="num">{t.saved.toLocaleString()}</td>
              <td className="num">{t.used + t.saved > 0 ? `${rowPct(t.used, t.saved)}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
