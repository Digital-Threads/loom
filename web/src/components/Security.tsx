import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent } from "../api";
import { StateView } from "./StateView";

// Security module — @digital-threads/loom-security. Shows the audit trail
// (blocked/warned commands, secret findings, worktree lifecycle) that the
// sandbox/policy/secret-scan layer emits to the event bus.
export function Security({ client }: { client: LoomClient }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    client.timeline().then((all) => setEvents(all.filter((e) => e.type.startsWith("audit.")))).catch((e) => setErr(String(e)));
  }, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!events) return <StateView kind="loading" />;

  const label = (t: string) => t.replace(/^audit\./, "");
  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Песочница для агента: worktree-изоляция, политика команд, скан секретов, аудит.
        Standalone-пакет <code>@digital-threads/loom-security</code>.
      </p>
      <h2>Аудит-журнал</h2>
      {events.length === 0 ? (
        <StateView kind="empty" msg="Пока нет аудит-событий — заблокированные команды, найденные секреты и жизненный цикл worktree появятся здесь." />
      ) : (
        <ul className="finding-list">
          {events.slice(0, 100).map((e, i) => (
            <li key={i} className={`finding ${e.type.includes("blocked") || e.type.includes("secret") ? "sev-bug" : "sev-info"}`}>
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
