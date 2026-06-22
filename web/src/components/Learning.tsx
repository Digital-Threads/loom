import { useEffect, useState } from "react";
import type { LoomClient, Lesson } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";
import { useT } from "../i18n";

// L8 Slice 0 — read-only "lessons": what keeps going wrong, so the next run can
// avoid it. Two sources: review findings that recur across tasks, and explicit
// user corrections (which rank first — a deliberate "do it this way").
export function Learning({ client }: { client: LoomClient }) {
  const t = useT();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [busy, setBusy] = useState(true);
  const [ran, setRan] = useState(false);
  const [genFor, setGenFor] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      setLessons((await client.lessons()).lessons);
    } catch (e) {
      toast.error(`${t("learning.loadFailed")}: ${e}`);
      setLessons([]);
    }
    setRan(true);
    setBusy(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function createSkill(l: Lesson) {
    setGenFor(l.signature);
    try {
      const r = await client.skillFromLesson(l.signature);
      toast.success(`${t("learning.skillDraftPrefix")}“${r.name}”${t("learning.skillDraftSuffix")}`);
    } catch (e) {
      toast.error(`${t("learning.skillGenFailed")}: ${e}`);
    }
    setGenFor(null);
  }

  async function dismiss(l: Lesson) {
    try {
      await client.dismissLesson(l.signature);
      setLessons((ls) => ls.filter((x) => x.signature !== l.signature));
    } catch (e) {
      toast.error(`${t("learning.dismissFailed")}: ${e}`);
    }
  }

  // Effectiveness: earlier→recent occurrences. ↓ = recurrence trending down (working).
  const trendChip = (l: Lesson) =>
    l.trend && l.trend.recent + l.trend.prior > 0 ? (
      <span className="n" title={t("learning.trendTitle")}>
        {l.trend.recent < l.trend.prior ? "↓" : l.trend.recent > l.trend.prior ? "↑" : "→"} {l.trend.prior}→{l.trend.recent}
      </span>
    ) : null;

  const actions = (l: Lesson) => (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn" disabled={genFor !== null} onClick={() => createSkill(l)}>
        {genFor === l.signature ? t("learning.generating") : t("learning.createSkill")}
      </button>
      <button className="btn" onClick={() => dismiss(l)}>{t("learning.dismiss")}</button>
    </span>
  );

  const corrections = lessons.filter((l) => l.kind === "correction");
  const findings = lessons.filter((l) => l.kind === "finding");

  return (
    <div className="panel learning">
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" disabled={busy} onClick={load}>{t("learning.refresh")}</button>
      </div>

      {busy ? <StateView kind="loading" msg={t("learning.computing")} /> : null}

      {!busy && ran && lessons.length === 0 ? (
        <StateView
          kind="empty"
          msg={t("learning.empty")}
        />
      ) : null}

      {corrections.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>✎ {t("learning.fromCorrections")} <span className="n">{corrections.length}</span></h2>
          {corrections.map((l, i) => (
            <div className="kv" key={i}>
              <b>{l.file ?? "—"}</b>
              <span>
                {l.sampleMessages[0] ?? l.signature}
                {l.occurrences > 1 ? ` · ×${l.occurrences}` : ""}
              </span>
              {actions(l)}
            </div>
          ))}
        </>
      ) : null}

      {findings.length ? (
        <>
          <h2 style={{ marginTop: 18 }}>↻ {t("learning.recurringFindings")} <span className="n">{findings.length}</span></h2>
          {findings.map((l, i) => (
            <div className={`kv ${l.severity === "error" ? "warn" : ""}`} key={i}>
              <b>{l.file ?? "—"}</b>
              <span>
                [{l.severity}] {l.sampleMessages[0] ?? ""} · {t("learning.recurredTimes")}×{l.occurrences} {t("learning.acrossTasks")} {l.taskIds.length} {t("learning.tasks")} {trendChip(l)}
              </span>
              {actions(l)}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
