import { useEffect, useState } from "react";
import type { LoomClient } from "../api";
import { StateView } from "./StateView";
import { toast } from "../toast";
import { useLang, useT } from "../i18n";

// D6.2 — Settings: default run_mode, token-pilot on/off, notifications on/off.
// Per-stage flow defaults live in the L6 flow-config (the Quality page); surfaced
// here as a shortcut so they're discoverable from Settings.
export function Settings({ client, onNav }: { client: LoomClient; onNav?: (view: string) => void }) {
  const t = useT();
  const { setLang } = useLang();
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Local draft for the taste-profile textarea (null = not yet edited → show the
  // persisted value). Kept local so typing isn't reset when other settings save.
  const [taste, setTaste] = useState<string | null>(null);

  useEffect(() => { client.settings().then(setS).catch((e) => setErr(String(e))); }, [client]);

  async function save(key: string, value: unknown) {
    try {
      await client.saveSetting(key, value);
      setS((cur) => ({ ...(cur ?? {}), [key]: value }));
      toast.success(t("settings.saved"));
    } catch (e) {
      toast.error(`${t("settings.saveFailed")}: ${e}`);
    }
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!s) return <StateView kind="loading" />;

  const runMode = (s["run_mode"] as string) ?? "gated";
  const language = (s["ui.language"] as string) ?? "en";
  const notify = (s["notify.enabled"] as boolean) ?? true;
  const sandbox = (s["sandbox.enabled"] as boolean) ?? false;
  const costCap = (s["cost.capUsd"] as number) ?? 0;

  return (
    <div className="panel">
      <div className="kv">
        <b>{t("settings.defaultRunMode")}</b>
        <span>
          {(["manual", "gated", "autopilot"] as const).map((m) => (
            <button key={m} className={`btn ${runMode === m ? "acc" : ""}`} style={{ marginRight: 6 }} onClick={() => save("run_mode", m)}>{t(`settings.runMode.${m}`)}</button>
          ))}
        </span>
      </div>
      <div className="kv">
        <b>{t("settings.language")}</b>
        <span>
          {(["en", "ru"] as const).map((l) => (
            <button key={l} className={`btn ${language === l ? "acc" : ""}`} style={{ marginRight: 6 }} onClick={() => { setLang(l); save("ui.language", l); }}>{l === "en" ? "English" : "Русский"}</button>
          ))}
          <span className="fld-hint" style={{ display: "block", marginTop: 4 }}>{t("settings.language.hint")}</span>
        </span>
      </div>
      <div className="kv">
        <b>{t("settings.costCap")}</b>
        <span>
          <input className="inp" type="number" min={0} step={1} defaultValue={costCap} style={{ width: 80, minWidth: 0 }}
            onBlur={(e) => {
              const capped = Math.max(0, Number(e.target.value) || 0);
              e.target.value = String(capped);
              save("cost.capUsd", capped);
            }} />
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>{t("settings.costCap.noLimit")}</span>
        </span>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: -4 }}>
        {t("settings.costCap.hint")}
      </div>
      <div className="kv">
        <b>{t("settings.notifications")}</b>
        <span><button className="btn" onClick={() => save("notify.enabled", !notify)}>{notify ? t("settings.on") : t("settings.off")}</button></span>
      </div>
      <div className="kv">
        <b>{t("settings.sandbox")} <span className="chip" style={{ marginLeft: 6 }}>{t("settings.experimental")}</span></b>
        <span>
          <button className={`btn ${sandbox ? "acc" : ""}`} onClick={() => save("sandbox.enabled", !sandbox)}>{sandbox ? t("settings.on") : t("settings.off")}</button>
        </span>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: -4 }}>
        {t("settings.sandbox.hint")}
      </div>
      <div className="kv">
        <b>{t("settings.flowDefaults")}</b>
        <span>
          {onNav
            ? <button className="btn" onClick={() => onNav("quality")}>{t("settings.openQuality")} →</button>
            : <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>{t("settings.flowDefaults.fallback")}</span>}
        </span>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: -4 }}>
        {t("settings.flowDefaults.hint")}
      </div>
      <div className="kv">
        <b>{t("settings.taste")}</b>
        <span>
          <textarea className="inp" rows={6} aria-label={t("settings.taste")}
            placeholder={t("settings.taste.placeholder")}
            value={taste ?? ((s["taste.profile"] as string) ?? "")}
            onChange={(e) => setTaste(e.target.value)}
            onBlur={(e) => save("taste.profile", e.target.value.trim())}
            style={{ width: 420, maxWidth: "100%" }} />
          <span className="fld-hint" style={{ display: "block" }}>{t("settings.taste.hint")}</span>
          <span className="muted" style={{ display: "block", fontSize: "var(--fs-xs)", marginTop: 2 }}>
            {t("settings.taste.chars").replace("{n}", String((taste ?? ((s["taste.profile"] as string) ?? "")).length))}
          </span>
        </span>
      </div>
    </div>
  );
}
