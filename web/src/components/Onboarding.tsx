import { useCallback, useEffect, useState } from "react";
import type { LoomClient, HealthRow, PrereqReport } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";
import { StateView } from "./StateView";

// D2.2 — first-run wizard: shown when there are no projects. Walks a fresh
// machine through setup without a terminal — check the environment (required
// CLIs on PATH), add a healthy aimux subscription, then add the first project;
// once a project exists the board takes over (onDone).

// A profile is healthy when nothing is broken/missing/conflicting (mirrors
// Accounts.tsx so the two screens agree on what "healthy" means).
function isHealthy(h?: HealthRow): boolean {
  if (!h) return false;
  if (h.ok === false) return false; // aimux's authoritative "unusable" flag (matches router-live)
  return (h.broken?.length ?? 0) + (h.missing?.length ?? 0) + (h.conflicts?.length ?? 0) === 0;
}

export function Onboarding({ client, onDone }: { client: LoomClient; onDone: () => void }) {
  const [report, setReport] = useState<PrereqReport | null>(null);
  const [subs, setSubs] = useState<{ name: string }[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [profile, setProfile] = useState("");
  const [root, setRoot] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subMsg, setSubMsg] = useState<string | null>(null);
  const [projErr, setProjErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const [rep, ws] = await Promise.all([client.doctor(), client.workspace()]);
      setReport(rep);
      setSubs(ws.subscriptions as { name: string }[]);
      setHealth(ws.health);
    } catch (e) {
      setLoadErr(`Couldn't read your environment: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const healthFor = (name: string): HealthRow | undefined => health.find((h) => h.profile === name);
  const healthyProfiles = subs.filter((s) => isHealthy(healthFor(s.name)));
  const hasHealthy = healthyProfiles.length > 0;

  async function addSub() {
    if (!profile.trim()) return;
    setBusy(true);
    setSubMsg(null);
    try {
      const r = await client.addSubscription(profile.trim());
      if (!r.ok) { setSubMsg(`Couldn't add subscription: ${r.error ?? "failed"}`); return; }
      setProfile("");
      const ws = await client.workspace();
      setSubs(ws.subscriptions as { name: string }[]);
      setHealth(ws.health);
      setSubMsg("Subscription added. Authorize it from Subscriptions once you're on the board.");
    } catch (e) {
      setSubMsg(`Couldn't add subscription: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function addProject() {
    if (!root.trim()) return;
    setBusy(true);
    setProjErr(null);
    try {
      await client.addProject(root.trim());
      onDone();
    } catch (e) {
      setProjErr(`Couldn't add project: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="panel" style={{ maxWidth: 560 }}><StateView kind="loading" msg="Checking your environment…" /></div>;
  }
  if (loadErr) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <StateView kind="error" msg={loadErr} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn acc" onClick={() => void load()}>Retry</button>
        </div>
      </div>
    );
  }

  // Only non-optional tools block the main (prebuilt-binary) path; optional ones
  // (e.g. cargo, build-from-source only) are shown but never flagged as blocking.
  const requiredMissing = report ? report.tools.filter((t) => !t.optional && !t.found) : [];

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h1>Welcome to Loom</h1>
      <p className="muted">A few steps to get going — no terminal needed.</p>

      <h2 style={{ marginTop: 18 }}>1 · Check your environment</h2>
      {report ? (
        <div style={{ marginTop: 6 }}>
          {report.tools.map((t) => {
            const cls = t.found ? "ok" : t.optional ? "warn" : "bad";
            const label = t.found ? "found" : t.optional ? "optional" : "missing";
            return (
              <div key={t.name} className="row" style={{ gap: 8, marginTop: 4 }}>
                <span className={`chip ${cls}`}>{label}</span>
                <span>{t.name}</span>
                {!t.found ? <span className="muted">— {t.hint}</span> : null}
              </div>
            );
          })}
          {requiredMissing.length ? (
            <p className="muted" style={{ marginTop: 6 }}>
              Install the missing tool{requiredMissing.length > 1 ? "s" : ""} above, then click Retry.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="muted">Environment status unavailable.</div>
      )}

      <h2 style={{ marginTop: 18 }}>
        2 · Connect an AI subscription {hasHealthy ? <span className="chip ok">ready</span> : null}
      </h2>
      {hasHealthy ? (
        <div className="muted">Healthy profile: {healthyProfiles.map((p) => p.name).join(", ")}.</div>
      ) : (
        <>
          <div className="muted">No healthy aimux profile yet — add one to get started.</div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <input className="inp" placeholder="profile name (e.g. work)" value={profile} onChange={(e) => setProfile(e.target.value)} />
            <button className="btn acc" disabled={busy || !profile.trim()} onClick={addSub}>Add</button>
          </div>
        </>
      )}
      {subMsg ? <div className="muted" style={{ marginTop: 4 }}>{subMsg}</div> : null}

      <h2 style={{ marginTop: 18 }}>3 · Add your first project</h2>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <input className="inp" placeholder="/path/to/repo" value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="btn" onClick={() => setPicking(true)}>Browse…</button>
        <button className="btn acc" disabled={busy || !root.trim()} onClick={addProject}>Add project &amp; start</button>
      </div>
      {projErr ? <div className="state-err" style={{ marginTop: 6 }}>⚠ {projErr}</div> : null}
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRoot(p); setPicking(false); }} />
      ) : null}
    </div>
  );
}
