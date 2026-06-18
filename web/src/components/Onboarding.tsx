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

// Short "why" per required tool, shown next to its status so the user knows what
// each one is for (the doctor hint is the install pointer, this is the purpose).
const TOOL_WHY: Record<string, string> = {
  node: "JavaScript runtime Loom itself runs on.",
  npm: "Installs the Claude Code CLI and Node packages.",
  cargo: "Builds the Task Journal binary that stores your task memory.",
  claude: "Runs the AI agent that powers every task in Loom.",
};

// A single progress row streamed from the auto-installer.
interface InstallStep {
  id: string;
  title: string;
  state: "installing" | "done" | "skipped" | "failed";
  message?: string;
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

  const [installing, setInstalling] = useState(false);
  const [steps, setSteps] = useState<InstallStep[]>([]);

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

  // Auto-install missing tools/plugins over SSE, updating one row per unit as it
  // streams. Idempotent on the server; on "done" we re-check the environment so
  // the status chips above refresh. Errors surface per-row, never crash the page.
  function installMissing() {
    setInstalling(true);
    setSteps([]);
    const es = new EventSource(client.installMissingStreamUrl());
    const upsert = (s: InstallStep) =>
      setSteps((prev) => {
        const i = prev.findIndex((p) => p.id === s.id);
        if (i === -1) return [...prev, s];
        const next = prev.slice();
        next[i] = s;
        return next;
      });
    es.addEventListener("step", (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as InstallStep;
      upsert(e);
    });
    es.addEventListener("done", () => {
      es.close();
      setInstalling(false);
      void load();
    });
    es.onerror = () => {
      es.close();
      setInstalling(false);
    };
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

  // Anything missing (incl. optional cargo) can be auto-installed → show the button.
  const anyMissing = report ? report.tools.some((t) => !t.found) : false;

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
                {TOOL_WHY[t.name] ? <span className="muted">— {TOOL_WHY[t.name]}</span> : null}
              </div>
            );
          })}
          {anyMissing ? (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn acc" disabled={installing} onClick={installMissing}>
                {installing ? "Installing…" : "Install missing"}
              </button>
              <span className="muted">Installs the missing tools and bundled plugins for you — no terminal.</span>
            </div>
          ) : null}
          {steps.length ? (
            <div style={{ marginTop: 8 }}>
              {steps.map((s) => {
                const cls = s.state === "done" ? "ok" : s.state === "failed" ? "bad" : "warn";
                const text =
                  s.state === "installing" ? "installing…"
                    : s.state === "done" ? "done"
                    : s.state === "skipped" ? (s.message ?? "skipped")
                    : `failed: ${s.message ?? "error"}`;
                return (
                  <div key={s.id} className="row" style={{ gap: 8, marginTop: 4 }}>
                    <span className={`chip ${cls}`}>{s.state}</span>
                    <span>{s.title}</span>
                    <span className="muted">— {text}</span>
                  </div>
                );
              })}
            </div>
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
