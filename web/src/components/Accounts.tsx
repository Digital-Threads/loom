import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData, HealthRow } from "../api";

// F1.2 — aimux accounts: subscriptions, sessions, health, with [Check health]
// and [Set active] actions. Reads the aggregated 3-module workspace.
export function Accounts({ client }: { client: LoomClient }) {
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSub, setNewSub] = useState("");

  useEffect(() => {
    client.workspace().then(setWs).catch((e) => setErr(String(e)));
  }, [client]);

  async function addSub() {
    if (!newSub.trim()) return;
    setBusy(true);
    try {
      await client.addSubscription(newSub.trim());
      setNewSub("");
      setWs(await client.workspace());
    } finally {
      setBusy(false);
    }
  }

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;
  if (!ws) return <div className="empty">Loading…</div>;
  if (ws.subscriptions.length === 0 && ws.sessions.length === 0)
    return <div className="empty">No aimux subscriptions yet — add one to get started.</div>;

  const healthFor = (profile: string): HealthRow | undefined =>
    ws.health.find((h) => h.profile === profile);

  async function checkHealth() {
    setBusy(true);
    try {
      const health = await client.accountsHealth();
      setWs((w) => (w ? { ...w, health } : w));
    } finally {
      setBusy(false);
    }
  }

  async function setActive(profile: string) {
    setBusy(true);
    try {
      await client.setActive(profile);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2>Subscriptions</h2>
        <span className="row" style={{ gap: 6 }}>
          <input className="inp" placeholder="new profile name" value={newSub} onChange={(e) => setNewSub(e.target.value)} />
          <button className="btn acc" disabled={busy || !newSub.trim()} onClick={addSub}>Add subscription</button>
          <button className="btn" disabled={busy} onClick={checkHealth}>Check health</button>
        </span>
      </div>
      <table className="tbl">
        <thead><tr><th>Profile</th><th>Health</th><th></th></tr></thead>
        <tbody>
          {ws.subscriptions.map((s) => {
            const h = healthFor(s.profile);
            return (
              <tr key={s.profile}>
                <td>{s.profile}</td>
                <td>
                  <span className={`chip ${h?.ok ? "ok" : "warn"}`}>
                    <span className="dotc" />{h?.ok ? "healthy" : "unknown"}
                  </span>
                </td>
                <td><button className="btn" disabled={busy} onClick={() => setActive(s.profile)}>Set active</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 style={{ marginTop: 24 }}>Sessions</h2>
      {ws.sessions.length ? (
        <div className="b">{ws.sessions.length} session(s)</div>
      ) : (
        <div className="empty">No sessions recorded.</div>
      )}
    </div>
  );
}
