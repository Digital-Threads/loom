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

  const spent = ws.tokens.reduce((a, t) => a + t.used, 0);
  const saved = ws.tokens.reduce((a, t) => a + t.saved, 0);

  return (
    <div className="panel">
      <div className="row" style={{ gap: 24 }}>
        <div><div className="grp">Spent</div><div className="big">{spent.toLocaleString()}</div></div>
        <div><div className="grp">Saved ≈ estimate</div><div className="big">{saved.toLocaleString()}</div></div>
      </div>
      <h2 style={{ marginTop: 24 }}>By session</h2>
      <table className="tbl">
        <thead><tr><th>Session</th><th>Used</th><th>Saved ≈</th></tr></thead>
        <tbody>
          {ws.tokens.map((t) => (
            <tr key={t.sessionId}>
              <td>{t.sessionId}</td>
              <td>{t.used.toLocaleString()}</td>
              <td>{t.saved.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ws.tokenEvents.length ? (
        <>
          <h2 style={{ marginTop: 24 }}>Recent events</h2>
          <div className="b">{ws.tokenEvents.length} event(s)</div>
        </>
      ) : null}
    </div>
  );
}
