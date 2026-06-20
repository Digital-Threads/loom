import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { Select } from "./Select";
import { toast } from "../toast";
import { useT } from "../i18n";

// Quality module — @digital-threads/loom-quality. The review pipeline and the QA
// checks are both editable (toggle / reorder), persisted via flow-config:
// flow.review for reviewers, flow.qa for QA checks.
const QA_OPTIONS = [
  { key: "tests", label: "tests", desc: "quality.qaCheck.tests.desc" },
  { key: "build", label: "build", desc: "quality.qaCheck.build.desc" },
];
const REVIEWERS = [
  { key: "self", label: "quality.reviewer.self.label", desc: "quality.reviewer.self.desc" },
  { key: "ralph", label: "Ralph-loop", desc: "quality.reviewer.ralph.desc" },
  { key: "adversarial", label: "Adversarial", desc: "quality.reviewer.adversarial.desc" },
];

export function Quality({ client }: { client: LoomClient }) {
  const t = useT();
  const [qa, setQa] = useState<string[] | null>(null);
  const [reviewers, setReviewers] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rBusy, setRBusy] = useState(false);
  const [qaMode, setQaMode] = useState("minimal"); // global default QA depth
  useEffect(() => {
    client.flowConfig("qa").then(setQa).catch((e) => setErr(String(e)));
    client.flowConfig("review").then(setReviewers).catch((e) => setErr(String(e)));
    client.settings().then((s) => { if (s["qa.mode"] === "full") setQaMode("full"); }).catch(() => {});
  }, [client]);

  function saveQaMode(v: string) {
    setQaMode(v);
    client.saveSetting("qa.mode", v).then(() => toast.success(t("quality.toast.qaDepthSaved"))).catch((e) => toast.error(`${t("quality.toast.couldntSave")}: ${e}`));
  }

  function toggle(key: string) {
    if (!qa) return;
    const next = qa.includes(key) ? qa.filter((k) => k !== key) : [...qa, key];
    setQa(next);
    setBusy(true);
    client.saveFlowConfig("qa", next).then(() => toast.success(t("quality.toast.qaSaved"))).catch((e) => toast.error(`${t("quality.toast.couldntSave")}: ${e}`)).finally(() => setBusy(false));
  }

  function saveReviewers(next: string[]) {
    setReviewers(next);
    setRBusy(true);
    client.saveFlowConfig("review", next)
      // Re-sync from the server so the UI reflects the resolved truth: empty →
      // default (all enabled), and any deduped/invalid keys are normalised.
      .then(() => { toast.success(t("quality.toast.reviewersSaved")); return client.flowConfig("review").then(setReviewers); })
      .catch((e) => toast.error(`${t("quality.toast.couldntSave")}: ${e}`)).finally(() => setRBusy(false));
  }
  function toggleReviewer(key: string) {
    if (!reviewers) return;
    saveReviewers(reviewers.includes(key) ? reviewers.filter((k) => k !== key) : [...reviewers, key]);
  }
  function moveReviewer(key: string, dir: -1 | 1) {
    if (!reviewers) return;
    const i = reviewers.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= reviewers.length) return;
    const next = [...reviewers];
    [next[i], next[j]] = [next[j], next[i]];
    saveReviewers(next);
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        {t("quality.intro")} <code>@digital-threads/loom-quality</code>.
      </p>

      <h2>{t("quality.reviewPipeline.title")} <span className="muted" style={{ fontSize: "var(--fs-xs)", fontWeight: 400 }}>{t("quality.reviewPipeline.hint")}</span></h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "var(--fs-xs)" }}>
        {t("quality.reviewPipeline.desc")}
      </p>
      {!reviewers ? <StateView kind="loading" /> : (
        <ul className="finding-list">
          {[...reviewers.map((k) => REVIEWERS.find((r) => r.key === k)).filter(Boolean) as typeof REVIEWERS,
            ...REVIEWERS.filter((r) => !reviewers.includes(r.key))].map((r) => {
            const on = reviewers.includes(r.key);
            const idx = reviewers.indexOf(r.key);
            return (
              <li key={r.key} className={`finding ${on ? "sev-info" : ""}`}>
                <button className={`btn sm ${on ? "acc" : ""}`} disabled={rBusy} title={on ? t("quality.action.disable") : t("quality.action.enable")} onClick={() => toggleReviewer(r.key)}>
                  {on ? "✓" : "○"}
                </button>
                {on && (
                  <span className="row" style={{ gap: 4 }}>
                    <button className="btn sm" disabled={rBusy || idx === 0} title={t("quality.action.moveUp")} onClick={() => moveReviewer(r.key, -1)}>↑</button>
                    <button className="btn sm" disabled={rBusy || idx === reviewers.length - 1} title={t("quality.action.moveDown")} onClick={() => moveReviewer(r.key, 1)}>↓</button>
                  </span>
                )}
                <span className="finding-sev">{r.label.includes(".") ? t(r.label) : r.label}</span>
                <span className="finding-msg">{t(r.desc)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>{t("quality.reviewPipeline.order")}</p>

      <h2>{t("quality.qaDepth.title")}</h2>
      <label className="fld" style={{ maxWidth: 360 }}>
        <Select block value={qaMode} onChange={(e) => saveQaMode(e.target.value)}>
          <option value="minimal">{t("quality.qaDepth.minimal")}</option>
          <option value="full">{t("quality.qaDepth.full")}</option>
        </Select>
        <span className="fld-hint">{t("quality.qaDepth.hint")}</span>
      </label>

      <h2>{t("quality.qaChecks.title")} <span className="muted" style={{ fontSize: "var(--fs-xs)", fontWeight: 400 }}>{t("quality.qaChecks.hint")}</span></h2>
      {!qa ? <StateView kind="loading" /> : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {QA_OPTIONS.map((o) => {
            const on = qa.includes(o.key);
            return (
              <button key={o.key} className={`btn sm ${on ? "acc" : ""}`} disabled={busy} title={t(o.desc)} onClick={() => toggle(o.key)}>
                {on ? "✓ " : "○ "}{o.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 8 }}>{t("quality.qaChecks.note")}</p>
    </div>
  );
}
