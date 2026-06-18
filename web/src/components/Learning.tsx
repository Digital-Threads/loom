import { useEffect, useState } from "react";
import type { LoomClient, Lesson } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";

// L8 Slice 0 — read-only "lessons": what keeps going wrong, so the next run can
// avoid it. Two sources: review findings that recur across tasks, and explicit
// user corrections (which rank first — a deliberate "do it this way").
export function Learning({ client }: { client: LoomClient }) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(true);
  const [ran, setRan] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setLessons((await client.lessons()).lessons);
    } catch (e) {
      toast.error(`Learning failed: ${e}`);
      setLessons([]);
    }
    setRan(true);
    setBusy(false);
  }
  useEffect(() => {
    load();
  }, []);

  const corrections = lessons.filter((l) => l.kind === "correction");
  const findings = lessons.filter((l) => l.kind === "finding");

  return (
    <div className="panel learning">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={busy} onClick={load}>Refresh</button>
      </div>

      {busy ? <StateView kind="loading" msg="Computing lessons…" /> : null}

      {!busy && ran && lessons.length === 0 ? (
        <StateView
          kind="empty"
          msg="No recurring lessons yet. They surface once review findings repeat across tasks, or when you correct the agent."
        />
      ) : null}

      {corrections.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>✎ From your corrections <span className="n">{corrections.length}</span></h2>
          {corrections.map((l, i) => (
            <div className="kv" key={i}>
              <b>{l.file ?? "—"}</b>
              <span>
                {l.sampleMessages[0] ?? l.signature}
                {l.occurrences > 1 ? ` · ×${l.occurrences}` : ""}
              </span>
            </div>
          ))}
        </>
      ) : null}

      {findings.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>↻ Recurring findings <span className="n">{findings.length}</span></h2>
          {findings.map((l, i) => (
            <div className={`kv ${l.severity === "error" ? "warn" : ""}`} key={i}>
              <b>{l.file ?? "—"}</b>
              <span>
                [{l.severity}] {l.sampleMessages[0] ?? ""} · recurred ×{l.occurrences} across {l.taskIds.length} tasks
              </span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
