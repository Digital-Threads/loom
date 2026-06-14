import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";

// D2.2 — first-run wizard: shown when there are no projects. Add the first
// aimux subscription and the first project; then the board takes over.
export function Onboarding({ client, onDone }: { client: LoomClient; onDone: () => void }) {
  const [subs, setSubs] = useState<number | null>(null);
  const [profile, setProfile] = useState("");
  const [root, setRoot] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    client.workspace().then((w) => setSubs(w.subscriptions.length)).catch(() => setSubs(0));
  }, [client]);

  async function addSub() {
    if (!profile.trim()) return;
    setBusy(true);
    try {
      const r = await client.addSubscription(profile.trim());
      setMsg(r.ok ? "Subscription added." : `Error: ${r.error ?? "failed"}`);
      const w = await client.workspace();
      setSubs(w.subscriptions.length);
      setProfile("");
    } finally { setBusy(false); }
  }
  async function addProject() {
    if (!root.trim()) return;
    setBusy(true);
    try { await client.addProject(root.trim()); onDone(); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h1>Welcome to Loom</h1>
      <p className="muted">Two steps to get going.</p>

      <h2 style={{ marginTop: 18 }}>1 · Connect an AI subscription</h2>
      <div className="muted">aimux profiles found: {subs ?? "…"}</div>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <input className="inp" placeholder="profile name (e.g. work)" value={profile} onChange={(e) => setProfile(e.target.value)} />
        <button className="btn acc" disabled={busy} onClick={addSub}>Add</button>
      </div>
      {msg ? <div className="muted">{msg}</div> : null}

      <h2 style={{ marginTop: 18 }}>2 · Add your first project</h2>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <input className="inp" placeholder="/path/to/repo" value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="btn" onClick={() => setPicking(true)}>Browse…</button>
        <button className="btn acc" disabled={busy || !root.trim()} onClick={addProject}>Add project & start</button>
      </div>
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRoot(p); setPicking(false); }} />
      ) : null}
    </div>
  );
}
