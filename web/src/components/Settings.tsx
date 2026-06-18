import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// D6.2 — Settings: default run_mode, token-pilot on/off, notifications on/off.
// Per-stage flow defaults live in the L6 flow-config (the Quality page); surfaced
// here as a shortcut so they're discoverable from Settings.
export function Settings({ client, onNav }: { client: LoomClient; onNav?: (view: string) => void }) {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { client.settings().then(setS).catch((e) => setErr(String(e))); }, [client]);

  async function save(key: string, value: unknown) {
    try {
      await client.saveSetting(key, value);
      setS((cur) => ({ ...(cur ?? {}), [key]: value }));
      toast.success("Saved");
    } catch (e) {
      toast.error(`Couldn’t save: ${e}`);
    }
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!s) return <StateView kind="loading" />;

  const runMode = (s["run_mode"] as string) ?? "gated";
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
          <input className="inp" type="number" min={0} step={1} defaultValue={costCap} style={{ width: 80, minWidth: 0 }}
            onBlur={(e) => {
              const capped = Math.max(0, Number(e.target.value) || 0);
              e.target.value = String(capped);
              save("cost.capUsd", capped);
            }} />
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>0 = no limit (default)</span>
        </span>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: -4 }}>
        Useful with Anthropic API-key billing (pay-per-token) — caps spend per task; autopilot stops when reached. On a flat-rate subscription, leave 0.
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
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: -4 }}>
        Confines agent writes to the task worktree (bubblewrap / sandbox-exec). Requires the tool installed; verify in your environment.
      </div>
      <div className="kv">
        <b>Flow defaults</b>
        <span>
          {onNav
            ? <button className="btn" onClick={() => onNav("quality")}>Open Quality →</button>
            : <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>Set per-stage checks on the Quality page.</span>}
        </span>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: -4 }}>
        Per-stage quality checks and review passes are configured on the Quality page.
      </div>
    </div>
  );
}
