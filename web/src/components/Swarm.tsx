import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// Swarm module — @digital-threads/loom-swarm. Multi-agent utility (concurrent
// runs + consensus). Two live bits here: a persistent "Default attempts" setting
// (swarm.attempts, saved like any other setting) and a log of past swarm runs
// read from the project event stream (events of type "swarm.*"). The runs list
// stays empty until swarm execution emits those events into the stream.
const MAX_ATTEMPTS = 50;

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

  // Clamp to a sane range: at least 1, and a generous upper cap so an accidental
  // paste (e.g. "100000") can't persist an absurd fan-out. Non-numeric → default 3.
  async function saveAttempts(raw: string, el: HTMLInputElement): Promise<void> {
    const num = Math.round(Number(raw));
    const n = Number.isFinite(num) ? Math.min(MAX_ATTEMPTS, Math.max(1, num)) : 3;
    try {
      await client.saveSetting("swarm.attempts", n);
      setS((cur) => ({ ...(cur ?? {}), "swarm.attempts": n }));
      el.value = String(n); // reflect the stored value only after a successful save
      toast.success("Saved");
    } catch (e) {
      toast.error(`Couldn’t save: ${e}`); // leave the user's input as-is so they can retry
    }
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!s) return <StateView kind="loading" />;

  const attempts = (s["swarm.attempts"] as number) ?? 3;

  const caps = [
    { k: "runConcurrent", d: "Runs one task across several agents in parallel and collects the outcomes." },
    { k: "majorityVote", d: "Consensus over results — takes the majority answer." },
    { k: "successes", d: "Picks the successful outcomes from a set of attempts." },
  ];

  const sorted = [...runs].sort((a, b) => b.ts - a.ts);

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Multi-agent coordinator. Standalone package <code>@digital-threads/loom-swarm</code>.
      </p>

      <div className="kv">
        <b>Default attempts</b>
        <span>
          <input className="inp" type="number" min={1} max={MAX_ATTEMPTS} step={1} aria-label="Default attempts"
            defaultValue={attempts} style={{ width: 80, minWidth: 0 }}
            onBlur={(e) => { void saveAttempts(e.target.value, e.target); }} />
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>parallel attempts per swarm step (min 1)</span>
        </span>
      </div>

      <h2>Past runs</h2>
      {sorted.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No swarm runs recorded yet. Runs will appear here once swarm executes within a task.
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

      <h2>Capabilities</h2>
      <ul className="finding-list">
        {caps.map((c) => (
          <li key={c.k} className="finding sev-info">
            <span className="finding-sev">{c.k}</span>
            <span className="finding-msg">{c.d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
