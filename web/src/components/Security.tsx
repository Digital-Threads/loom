import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent } from "../api";
import { StateView } from "./StateView";

// Security module — @digital-threads/loom-security. Sandbox toggle + a summary
// and filterable audit trail (blocked/warned commands, secret findings, worktree
// lifecycle) that the policy/secret-scan layer emits to the event bus.
type Cat = "all" | "command" | "secret" | "worktree";
const CATS: { key: Cat; label: string }[] = [
  { key: "all", label: "All" },
  { key: "command", label: "Commands" },
  { key: "secret", label: "Secrets" },
  { key: "worktree", label: "Worktree" },
];
const catOf = (type: string): Cat =>
  type.includes("command") ? "command" : type.includes("secret") ? "secret" : type.includes("worktree") ? "worktree" : "all";

export function Security({ client }: { client: LoomClient }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [sandbox, setSandbox] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Cat>("all");
  const [err, setErr] = useState<string | null>(null);

  function load() {
    client.timeline().then((all) => setEvents(all.filter((e) => e.type.startsWith("audit.")))).catch((e) => setErr(String(e)));
    client.settings().then((s) => setSandbox((s["sandbox.enabled"] as boolean) ?? false))
      .catch((e) => { console.warn("settings unavailable:", e); setSandbox(false); }); // fall to a usable default, not a stuck "…"
  }
  useEffect(load, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!events) return <StateView kind="loading" />;

  const count = (c: Cat) => events.filter((e) => catOf(e.type) === c).length;
  const shown = filter === "all" ? events : events.filter((e) => catOf(e.type) === filter);
  const label = (t: string) => t.replace(/^audit\./, "");

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Agent sandbox: worktree isolation, command policy, secret scanning, audit.
        Standalone package <code>@digital-threads/loom-security</code>.
      </p>

      <div className="kv">
        <b>OS sandbox</b>
        <span>
          <button className={`btn ${sandbox ? "acc" : ""}`} disabled={sandbox === null}
            onClick={() => { const v = !sandbox; setSandbox(v); client.saveSetting("sandbox.enabled", v).catch(() => setSandbox(!v)); }}>
            {sandbox === null ? "…" : sandbox ? "on" : "off"}
          </button>
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>Confines agent writes to the worktree (bubblewrap / sandbox-exec).</span>
        </span>
      </div>

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div className="stat"><div className="big">{count("command")}</div><div className="stat-sub">commands blocked / warned</div></div>
        <div className="stat"><div className="big">{count("secret")}</div><div className="stat-sub">secrets found</div></div>
        <div className="stat"><div className="big">{count("worktree")}</div><div className="stat-sub">worktree events</div></div>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>
        Secret scanning runs on every agent turn. Command-blocking and worktree events require the OS sandbox (above) — those counters stay 0 until it's enabled.
      </div>

      <div className="row" style={{ gap: 6, margin: "16px 0 8px" }}>
        {CATS.map((c) => (
          <button key={c.key} className={`btn sm ${filter === c.key ? "acc" : ""}`} onClick={() => setFilter(c.key)}>
            {c.label}{c.key !== "all" ? ` (${count(c.key)})` : ""}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <StateView kind="empty" msg="No audit events in this category." />
      ) : (
        <ul className="finding-list">
          {shown.slice(0, 150).map((e, i) => (
            <li key={i} className={`finding ${catOf(e.type) === "command" || catOf(e.type) === "secret" ? "sev-bug" : "sev-info"}`}>
              <span className="finding-sev">{label(e.type)}</span>
              <span className="finding-msg">
                {e.message}
                {e.taskId ? <code className="finding-file" style={{ marginLeft: 8 }}>{e.taskId}</code> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
