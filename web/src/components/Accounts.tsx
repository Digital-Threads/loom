import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData, HealthRow } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

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
      toast.success("Subscription added");
    } catch { toast.error("Couldn’t add subscription"); } finally {
      setBusy(false);
    }
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!ws) return <StateView kind="loading" />;
  if (ws.subscriptions.length === 0 && ws.sessions.length === 0)
    return <div className="empty">No aimux subscriptions yet — add one to get started.</div>;

  const healthFor = (profile: string): HealthRow | undefined =>
    ws.health.find((h) => h.profile === profile);

  // HealthReport has no boolean — derive it: a profile is healthy when nothing
  // is broken, missing, or conflicting.
  function healthState(h?: HealthRow): { cls: string; label: string } {
    if (!h) return { cls: "warn", label: "unknown" };
    const bad = (h.broken?.length ?? 0) + (h.missing?.length ?? 0) + (h.conflicts?.length ?? 0);
    if (bad > 0) return { cls: "bad", label: `${bad} issue${bad > 1 ? "s" : ""}` };
    return { cls: "ok", label: "healthy" };
  }

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
      toast.success(`Active profile: ${profile}`);
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
        <thead><tr><th>Profile</th><th>CLI</th><th>Health</th><th></th></tr></thead>
        <tbody>
          {ws.subscriptions.map((s) => {
            const st = healthState(healthFor(s.name));
            return (
              <tr key={s.name}>
                <td>
                  {s.name || <span className="muted">(unnamed)</span>}
                  {s.isSource ? <span className="chip ok" style={{ marginLeft: 8 }}>source</span> : null}
                </td>
                <td className="crumb">{s.cli ?? "—"}</td>
                <td>
                  <span className={`chip ${st.cls}`}><span className="dotc" />{st.label}</span>
                </td>
                <td style={{ textAlign: "right" }}><button className="btn" disabled={busy} onClick={() => setActive(s.name)}>Set active</button></td>
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
