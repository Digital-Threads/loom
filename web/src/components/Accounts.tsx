import { useEffect, useState } from "react";
import type { LoomClient, WorkspaceData, HealthRow, RateLimit } from "../api";
import { StateView } from "./StateView";
import { AuthModal } from "./AuthModal";
import { toast } from "../toast";

// Color a utilization % like aimux's status bar: green under 70, amber to 90, red above.
function pctCls(p: number): string {
  return p >= 90 ? "bad" : p >= 70 ? "warn" : "ok";
}

export function Accounts({ client }: { client: LoomClient }) {
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newSub, setNewSub] = useState("");
  // Remove-confirmation: the profile name being confirmed (null = not removing).
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeInput, setRemoveInput] = useState("");
  const [limits, setLimits] = useState<Record<string, RateLimit>>({});
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [authProfile, setAuthProfile] = useState<string | null>(null);

  useEffect(() => {
    client.workspace().then(setWs).catch((e) => setErr(String(e)));
    // Live rate-limit utilization per profile (OAuth only). Background — each is a
    // ~5s probe; the table renders immediately and the % fills in when ready.
    setLimitsLoading(true);
    client.accountLimits()
      .then((ls) => setLimits(Object.fromEntries(ls.map((l) => [l.profile, l]))))
      .catch(() => {})
      .finally(() => setLimitsLoading(false));
  }, [client]);

  async function addSub() {
    if (!newSub.trim()) return;
    setBusy(true);
    try {
      await client.addSubscription(newSub.trim());
      setNewSub("");
      setWs(await client.workspace());
      toast.success("Subscription added — authorize it with: aimux auth login " + newSub.trim());
    } catch { toast.error("Couldn't add subscription"); } finally { setBusy(false); }
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!ws) return <StateView kind="loading" />;
  if (ws.subscriptions.length === 0 && ws.sessions.length === 0)
    return <StateView kind="empty" msg="No aimux subscriptions yet — add one to get started." />;

  const healthFor = (profile: string): HealthRow | undefined =>
    ws.health.find((h) => h.profile === profile);

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
    } finally { setBusy(false); }
  }

  async function setActive(profile: string) {
    setBusy(true);
    try {
      await client.setActive(profile);
      setWs((w) => (w ? { ...w, activeProfile: profile } : w));
      toast.success(`Active profile: ${profile} — new tasks run under it`);
    } finally { setBusy(false); }
  }

  async function confirmRemove() {
    if (!removing || removeInput.trim() !== removing) return;
    setBusy(true);
    try {
      const res = await client.removeSubscription(removing);
      if (res.error) { toast.error(res.error); return; }
      setWs(await client.workspace());
      toast.success(`Removed: ${removing}`);
    } catch (e) { toast.error(`Couldn't remove: ${e}`); }
    finally { setBusy(false); setRemoving(null); setRemoveInput(""); }
  }

  const byProfile = Object.values(
    ws.sessions.reduce((acc, s) => {
      const p = (s.profile as string) || "";
      (acc[p] ??= { profile: p, count: 0, last: 0 }).count++;
      const t = (s.lastUsedAtMs as number) ?? 0;
      if (t > acc[p].last) acc[p].last = t;
      return acc;
    }, {} as Record<string, { profile: string; count: number; last: number }>),
  ).sort((a, b) => b.count - a.count);

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
      <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>
        Adding a profile only creates the config entry. To authorize it, run{" "}
        <code style={{ background: "var(--chip)", padding: "1px 5px", borderRadius: 4 }}>aimux auth login {"<name>"}</code> in a terminal.
      </div>
      <table className="tbl">
        <thead><tr><th>Profile</th><th>CLI</th><th>Health</th><th>5h limit</th><th>7d limit</th><th></th></tr></thead>
        <tbody>
          {ws.subscriptions.map((s) => {
            const st = healthState(healthFor(s.name));
            const active = !!ws.activeProfile && s.name === ws.activeProfile;
            const lim = limits[s.name];
            return (
              <tr key={s.name} className={active ? "row-active" : ""}>
                <td>
                  {s.name || <span className="muted">(unnamed)</span>}
                  {active ? <span className="chip ok" style={{ marginLeft: 8 }}>active</span> : null}
                  {s.isSource ? <span className="chip" style={{ marginLeft: 6 }}>source</span> : null}
                </td>
                <td className="crumb">{s.cli ?? "—"}</td>
                <td>
                  <span className={`chip ${st.cls}`}><span className="dotc" />{st.label}</span>
                </td>
                <td>
                  {lim ? <span className={`chip ${pctCls(lim.fiveHourPct)}`}>{lim.fiveHourPct}%</span>
                    : <span className="crumb" title="No subscription rate-limit window (API-key or unauthorized profile)">{limitsLoading ? "…" : "—"}</span>}
                </td>
                <td>
                  {lim ? <span className={`chip ${pctCls(lim.weeklyPct)}`}>{lim.weeklyPct}%</span>
                    : <span className="crumb">{limitsLoading ? "…" : "—"}</span>}
                </td>
                <td className="acct-act-cell">
                  <div className="acct-actions">
                    {s.authKind === "none" ? (
                      <button className="btn acc sm" disabled={busy} title="Sign in to this subscription" onClick={() => setAuthProfile(s.name)}>Authorize</button>
                    ) : null}
                    {active
                      ? <span className="muted" style={{ fontSize: 12 }}>in use</span>
                      : <button className="btn sm" disabled={busy} onClick={() => setActive(s.name)}>Set active</button>}
                    {!s.isSource && !active ? (
                      <button className="btn sm icon-bad" disabled={busy} title="Remove this subscription" onClick={() => { setRemoving(s.name); setRemoveInput(""); }}>✕</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Remove confirmation — modal; type the profile name to confirm, no accidental deletes */}
      {removing ? (
        <div className="overlay" onClick={() => setRemoving(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h" style={{ color: "var(--bad)" }}>Remove "{removing}"?</div>
            <div className="modal-b">
              <p style={{ margin: "0 0 12px", fontSize: 13 }}>
                This removes the profile entry from aimux config. Credentials on disk are not deleted.
                Type <b>{removing}</b> to confirm:
              </p>
              <input className="inp" autoFocus value={removeInput} placeholder={removing} onChange={(e) => setRemoveInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirmRemove(); }} style={{ width: "100%" }} />
            </div>
            <div className="modal-f">
              <button className="btn" onClick={() => setRemoving(null)}>Cancel</button>
              <button className="btn" disabled={busy || removeInput.trim() !== removing} style={{ color: "var(--bad)" }} onClick={confirmRemove}>Remove</button>
            </div>
          </div>
        </div>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Sessions <span className="n">{ws.sessions.length}</span></h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Claude conversations aimux is tracking (one per task run), grouped by the profile that ran them.
      </div>
      {ws.sessions.length ? (
        <table className="tbl">
          <thead><tr><th>Profile</th><th>Sessions</th><th>Last used</th></tr></thead>
          <tbody>
            {byProfile.map((r) => (
              <tr key={r.profile}>
                <td>{r.profile || <span className="muted">(unknown)</span>}</td>
                <td>{r.count}</td>
                <td className="crumb">{r.last ? new Date(r.last).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">No sessions recorded.</div>
      )}

      {authProfile ? (
        <AuthModal
          client={client}
          profile={authProfile}
          onClose={() => setAuthProfile(null)}
          onDone={() => {
            // Re-read the full workspace so authKind (Authorize button) + health update,
            // and refresh limits — without a manual page reload.
            client.workspace().then(setWs).catch(() => {});
            client.accountLimits().then((ls) => setLimits(Object.fromEntries(ls.map((l) => [l.profile, l])))).catch(() => {});
          }}
        />
      ) : null}
    </div>
  );
}
