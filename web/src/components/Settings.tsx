import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// D6.2 — Settings: default run_mode, token-pilot on/off, notifications on/off.
// (Per-column flow defaults reuse the L6 flow-config; surfaced here later.)
export function Settings({ client }: { client: LoomClient }) {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { client.settings().then(setS).catch((e) => setErr(String(e))); }, [client]);

  async function save(key: string, value: unknown) {
    await client.saveSetting(key, value);
    setS((cur) => ({ ...(cur ?? {}), [key]: value }));
    toast.success("Saved");
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!s) return <StateView kind="loading" />;

  const runMode = (s["run_mode"] as string) ?? "gated";
  const tokenPilot = (s["tokenPilot.enabled"] as boolean) ?? true;
  const notify = (s["notify.enabled"] as boolean) ?? true;
  const sandbox = (s["sandbox.enabled"] as boolean) ?? false;
  const costCap = (s["cost.capUsd"] as number) ?? 0;

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
        <b>Cost cap (per task, $)</b>
        <span>
          <input type="number" min={0} step={1} defaultValue={costCap} style={{ width: 80 }}
            onBlur={(e) => save("cost.capUsd", Number(e.target.value) || 0)} />
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>0 = без лимита; autopilot остановится при достижении</span>
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
      <div className="kv">
        <b>OS sandbox <span className="chip" style={{ marginLeft: 6 }}>experimental</span></b>
        <span>
          <button className={`btn ${sandbox ? "acc" : ""}`} onClick={() => save("sandbox.enabled", !sandbox)}>{sandbox ? "on" : "off"}</button>
        </span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        Confines agent writes to the task worktree (bubblewrap / sandbox-exec). Requires the tool installed; verify in your environment.
      </div>
    </div>
  );
}
