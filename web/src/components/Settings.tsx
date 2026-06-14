import { useEffect, useState } from "react";
import type { LoomClient } from "../api";

// D6.2 — Settings: default run_mode, token-pilot on/off, notifications on/off.
// (Per-column flow defaults reuse the L6 flow-config; surfaced here later.)
export function Settings({ client }: { client: LoomClient }) {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { client.settings().then(setS).catch((e) => setErr(String(e))); }, [client]);

  async function save(key: string, value: unknown) {
    await client.saveSetting(key, value);
    setS((cur) => ({ ...(cur ?? {}), [key]: value }));
  }

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;
  if (!s) return <div className="empty">Loading…</div>;

  const runMode = (s["run_mode"] as string) ?? "gated";
  const tokenPilot = (s["tokenPilot.enabled"] as boolean) ?? true;
  const notify = (s["notify.enabled"] as boolean) ?? true;

  return (
    <div className="panel">
      <div className="kv">
        <b>Default run mode</b>
        <span>
          {(["manual", "gated", "autopilot"] as const).map((m) => (
            <button key={m} className={`btn ${runMode === m ? "acc" : ""}`} style={{ marginRight: 6 }} onClick={() => save("run_mode", m)}>{m}</button>
          ))}
        </span>
      </div>
      <div className="kv">
        <b>token-pilot</b>
        <span><button className="btn" onClick={() => save("tokenPilot.enabled", !tokenPilot)}>{tokenPilot ? "on" : "off"}</button></span>
      </div>
      <div className="kv">
        <b>Notifications</b>
        <span><button className="btn" onClick={() => save("notify.enabled", !notify)}>{notify ? "on" : "off"}</button></span>
      </div>
    </div>
  );
}
