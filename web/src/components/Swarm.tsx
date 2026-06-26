import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// Swarm module — @digital-threads/loom-swarm. Per-stage swarm config plus a log
// of past swarm runs read from the project event stream (swarm.* events). Two
// stages are wired: impl (N candidate implementations in isolated worktrees,
// QA-gate, judge promotes the winner) and spec (N candidate SDDs, judge elects).
const MAX_ATTEMPTS = 5;

// Stages that can run as a swarm — each maps to a `swarm.<key>` setting.
const SWARM_STAGES: Array<{ key: string; title: string; runLabel: string; help: string }> = [
  { key: "impl", title: "Implementation swarm", runLabel: "Run impl as a swarm", help: "autopilot only — N candidate implementations, judge promotes the winner" },
  { key: "spec", title: "Spec swarm", runLabel: "Run spec as a swarm", help: "autopilot only — N candidate SDDs, judge elects the best" },
];

interface StageSwarm { enabled?: boolean; attempts?: number; perspectives?: string[] }

function StageBlock({ s, setS, client, stage }: {
  s: Record<string, unknown>;
  setS: (f: (cur: Record<string, unknown> | null) => Record<string, unknown>) => void;
  client: LoomClient;
  stage: { key: string; title: string; runLabel: string; help: string };
}) {
  const key = `swarm.${stage.key}`;
  const cfg = (s[key] as StageSwarm) ?? {};
  const enabled = cfg.enabled === true;
  const attempts = typeof cfg.attempts === "number" ? cfg.attempts : 3;
  const perspectives = Array.isArray(cfg.perspectives) ? cfg.perspectives.join(", ") : "";

  // Save a patch onto swarm.<stage> (the per-stage config resolveSwarmConfig reads).
  async function save(patch: StageSwarm): Promise<void> {
    const next = { ...cfg, ...patch };
    try {
      await client.saveSetting(key, next);
      setS((cur) => ({ ...(cur ?? {}), [key]: next }));
      toast.success("Saved");
    } catch (e) {
      toast.error(`Couldn’t save: ${e}`);
    }
  }

  return (
    <>
      <h2>{stage.title}</h2>
      <div className="kv">
        <b>{stage.runLabel}</b>
        <span>
          <button className={`btn ${enabled ? "acc" : ""}`} onClick={() => void save({ enabled: !enabled })}>{enabled ? "on" : "off"}</button>
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>{stage.help}</span>
        </span>
      </div>
      <div className="kv">
        <b>Attempts</b>
        <span>
          <input className="inp" type="number" min={1} max={MAX_ATTEMPTS} step={1} aria-label={`${stage.key} attempts`}
            defaultValue={attempts} style={{ width: 80, minWidth: 0 }}
            onBlur={(e) => { const n = Math.min(MAX_ATTEMPTS, Math.max(1, Math.round(Number(e.target.value)) || 3)); e.target.value = String(n); void save({ attempts: n }); }} />
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>candidates per run (1–{MAX_ATTEMPTS})</span>
        </span>
      </div>
      <div className="kv">
        <b>Perspectives</b>
        <span>
          <input className="inp" type="text" aria-label={`${stage.key} perspectives`} placeholder="simplest, robust, performance"
            defaultValue={perspectives} style={{ width: 280, maxWidth: "100%" }}
            onBlur={(e) => void save({ perspectives: e.target.value.split(",").map((p) => p.trim()).filter(Boolean) })} />
          <span className="fld-hint" style={{ display: "block", marginTop: 4 }}>Optional comma-separated lenses, one per candidate (e.g. simplest, robust).</span>
        </span>
      </div>
    </>
  );
}

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

  const sorted = [...runs].sort((a, b) => b.ts - a.ts);

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Run a stage as a swarm of N candidates — a judge elects the best. Standalone package <code>@digital-threads/loom-swarm</code>.
      </p>

      <div className="banner banner-warn" role="status" style={{ marginBottom: "var(--space-3)" }}>
        Preview — swarm stages are wired but off by default. When on, the stage runs N candidates and a judge picks the
        winner (impl gates each on the objective QA checks in an isolated worktree; spec elects the best SDD). Autopilot
        only; N× the cost. Verify on a real task before relying on it.
      </div>

      {SWARM_STAGES.map((stage) => <StageBlock key={stage.key} s={s} setS={setS} client={client} stage={stage} />)}

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
