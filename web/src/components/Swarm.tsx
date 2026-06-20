import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// Swarm module — @digital-threads/loom-swarm. Per-stage swarm config (currently
// impl-as-swarm: N candidate implementations, QA-gate, judge elects + promotes)
// plus a log of past swarm runs read from the project event stream (swarm.* events).
const MAX_ATTEMPTS = 5;

interface StageSwarm { enabled?: boolean; attempts?: number; perspectives?: string[] }

export function Swarm({ client }: { client: LoomClient }) {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<TimelineEvent[]>([]);

  useEffect(() => { client.settings().then(setS).catch((e) => setErr(String(e))); }, [client]);
  useEffect(() => {
    client.timeline()
      .then((events) => setRuns(events.filter((e) => typeof e.type === "string" && (e.type === "swarm" || e.type.startsWith("swarm.")))))
      .catch(() => setRuns([])); // the runs log is non-critical — a stream error just shows empty
  }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!s) return <StateView kind="loading" />;

  const impl = (s["swarm.impl"] as StageSwarm) ?? {};
  const enabled = impl.enabled === true;
  const attempts = typeof impl.attempts === "number" ? impl.attempts : 3;
  const perspectives = Array.isArray(impl.perspectives) ? impl.perspectives.join(", ") : "";

  // Save a patch onto swarm.impl (the per-stage config resolveSwarmConfig reads).
  async function saveImpl(patch: StageSwarm): Promise<void> {
    const next = { ...impl, ...patch };
    try {
      await client.saveSetting("swarm.impl", next);
      setS((cur) => ({ ...(cur ?? {}), "swarm.impl": next }));
      toast.success("Saved");
    } catch (e) {
      toast.error(`Couldn’t save: ${e}`);
    }
  }

  const sorted = [...runs].sort((a, b) => b.ts - a.ts);

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Run a stage as a swarm of N candidates — a judge elects the best. Standalone package <code>@digital-threads/loom-swarm</code>.
      </p>

      <div className="banner banner-warn" role="status" style={{ marginBottom: "var(--space-3)" }}>
        Preview — impl-as-swarm is wired (off by default). When on, the implementation stage runs N candidates in
        isolated worktrees, gates each on the objective QA checks, and a judge promotes the winner. Autopilot only;
        N× the cost. Verify on a real task before relying on it.
      </div>

      <h2>Implementation swarm</h2>
      <div className="kv">
        <b>Run impl as a swarm</b>
        <span>
          <button className={`btn ${enabled ? "acc" : ""}`} onClick={() => void saveImpl({ enabled: !enabled })}>{enabled ? "on" : "off"}</button>
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>autopilot only — N candidate implementations, judge elects the winner</span>
        </span>
      </div>
      <div className="kv">
        <b>Attempts</b>
        <span>
          <input className="inp" type="number" min={1} max={MAX_ATTEMPTS} step={1} aria-label="Attempts"
            defaultValue={attempts} style={{ width: 80, minWidth: 0 }}
            onBlur={(e) => { const n = Math.min(MAX_ATTEMPTS, Math.max(1, Math.round(Number(e.target.value)) || 3)); e.target.value = String(n); void saveImpl({ attempts: n }); }} />
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>candidates per impl (1–{MAX_ATTEMPTS})</span>
        </span>
      </div>
      <div className="kv">
        <b>Perspectives</b>
        <span>
          <input className="inp" type="text" aria-label="Perspectives" placeholder="simplest, robust, performance"
            defaultValue={perspectives} style={{ width: 280, maxWidth: "100%" }}
            onBlur={(e) => void saveImpl({ perspectives: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) })} />
          <span className="fld-hint" style={{ display: "block", marginTop: 4 }}>Optional comma-separated lenses, one per candidate (e.g. simplest, robust).</span>
        </span>
      </div>

      <h2>Past runs</h2>
      {sorted.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No swarm runs recorded yet. Runs appear here once a swarm stage executes within a task.
        </p>
      ) : (
        <ul className="finding-list">
          {sorted.map((r, i) => {
            const { count, total, ratio } = r.metrics ?? {};
            const agree = typeof ratio === "number"
              ? `${Math.round(ratio * 100)}% agreement`
              : (typeof count === "number" && typeof total === "number" ? `${count}/${total} agreement` : null);
            return (
              <li key={`${r.ts}-${i}`} className="finding sev-info">
                <span className="finding-sev">{r.type}</span>
                <span className="finding-msg">
                  {r.message ?? "swarm run"}
                  {agree ? ` — ${agree}` : ""}
                  {" · "}{new Date(r.ts).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
