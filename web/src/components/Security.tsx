import { useEffect, useState } from "react";
import type { LoomClient, TimelineEvent, SecretRule, SecurityPolicyData, SecuritySecretsData } from "../api";
import { StateView } from "./StateView";
import { useT } from "../i18n";

// Security module — @digital-threads/loom-security. Sandbox toggle, a summary
// and filterable audit trail (blocked/warned commands, secret findings, worktree
// lifecycle), plus configuration of the command policy (allow/deny) and the
// secret-scan rules with an on/off switch and a policy summary.
type Cat = "all" | "command" | "secret" | "worktree" | "egress";
const CATS: { key: Cat; label: string }[] = [
  { key: "all", label: "All" },
  { key: "command", label: "Commands" },
  { key: "secret", label: "Secrets" },
  { key: "worktree", label: "Worktree" },
  { key: "egress", label: "Egress" },
];
const catOf = (type: string): Cat =>
  type.includes("command") ? "command" : type.includes("secret") ? "secret" : type.includes("worktree") ? "worktree" : type.includes("egress") ? "egress" : "all";

// Mirror of the backend DEFAULT_EGRESS_ALLOW — shown in the editor when the
// operator hasn't set their own list, so they can see and extend the defaults.
const DEFAULT_ALLOW = [
  "api.anthropic.com", "*.anthropic.com",
  "registry.npmjs.org", "*.npmjs.org",
  "github.com", "*.github.com", "*.githubusercontent.com",
  "pypi.org", "*.pypi.org", "files.pythonhosted.org",
];

const isValidRegex = (s: string): boolean => {
  try { new RegExp(s); return true; } catch { return false; }
};

// Editor for a list of RegExp-source strings: built-in entries shown read-only,
// user entries removable, with an input to add one. Invalid patterns are blocked.
function PatternList({
  title, builtin, items, onAdd, onRemove, placeholder,
}: {
  title: string;
  builtin?: string[];
  items: string[];
  onAdd: (v: string) => void;
  onRemove: (i: number) => void;
  placeholder: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const valid = draft.trim() === "" || isValidRegex(draft);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginBottom: 4 }}>{title}</div>
      {builtin?.length ? (
        <ul className="finding-list">
          {builtin.map((b, i) => (
            <li key={`b${i}`} className="finding sev-info">
              <span className="finding-sev">{t("security.builtin")}</span>
              <span className="finding-msg"><code className="finding-file">{b}</code></span>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length ? (
        <ul className="finding-list">
          {items.map((it, i) => (
            <li key={`u${i}`} className="finding sev-bug">
              <span className="finding-sev">{t("security.custom")}</span>
              <span className="finding-msg">
                <code className="finding-file">{it}</code>
                <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => onRemove(i)}>{t("security.action.remove")}</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <input className="inp" placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim() && valid) { onAdd(draft.trim()); setDraft(""); } }} style={{ flex: 1 }} />
        <button className="btn sm acc" disabled={!draft.trim() || !valid}
          onClick={() => { onAdd(draft.trim()); setDraft(""); }}>{t("security.action.add")}</button>
      </div>
      {!valid ? <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>{t("security.invalidRegex")}</div> : null}
    </div>
  );
}

export function Security({ client }: { client: LoomClient }) {
  const t = useT();
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [sandbox, setSandbox] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Cat>("all");
  const [err, setErr] = useState<string | null>(null);

  const [policy, setPolicy] = useState<SecurityPolicyData | null>(null);
  const [secrets, setSecrets] = useState<SecuritySecretsData | null>(null);
  const [allow, setAllow] = useState<string[]>([]);
  const [deny, setDeny] = useState<string[]>([]);
  const [egressEnforce, setEgressEnforce] = useState<boolean | null>(null);
  const [egressAllow, setEgressAllow] = useState<string>("");
  const [rules, setRules] = useState<SecretRule[]>([]);
  const [ruleKind, setRuleKind] = useState("");
  const [ruleSrc, setRuleSrc] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  function load() {
    client.timeline().then((all) => setEvents(all.filter((e) => e.type.startsWith("audit.")))).catch((e) => setErr(String(e)));
    client.settings().then((s) => {
      setSandbox((s["sandbox.enabled"] as boolean) ?? false);
      setEgressEnforce((s["security.egress.enforce"] as boolean) ?? false);
      const a = s["security.egress.allow"] as string[] | undefined;
      setEgressAllow((a && a.length ? a : DEFAULT_ALLOW).join("\n"));
    }).catch((e) => { console.warn("settings unavailable:", e); setSandbox(false); setEgressEnforce(false); setEgressAllow(DEFAULT_ALLOW.join("\n")); }); // usable defaults, not a stuck "…"
    client.securityPolicy().then((p) => { setPolicy(p); setAllow(p.allow); setDeny(p.deny); }).catch((e) => console.warn("policy unavailable:", e));
    client.securitySecrets().then((s) => { setSecrets(s); setRules(s.custom); }).catch((e) => console.warn("secret rules unavailable:", e));
  }
  useEffect(load, [client]);

  if (err) return <StateView kind="error" msg={err} />;
  if (!events) return <StateView kind="loading" />;

  const count = (c: Cat) => events.filter((e) => catOf(e.type) === c).length;
  const shown = filter === "all" ? events : events.filter((e) => catOf(e.type) === filter);
  const label = (t: string) => t.replace(/^audit\./, "");

  const scanOn = secrets?.enabled ?? true;
  const toggleScan = () => {
    const next = !scanOn;
    setSecrets((s) => (s ? { ...s, enabled: next } : s));
    // Only flip the switch — don't commit unsaved custom-rule edits in `rules`.
    client.setSecretScanEnabled(next)
      .then((r) => { if (r.error) { setSaveMsg(r.error); setSecrets((s) => (s ? { ...s, enabled: !next } : s)); } })
      .catch(() => setSecrets((s) => (s ? { ...s, enabled: !next } : s)));
  };
  const savePolicy = () => {
    setSaveMsg(null);
    client.saveSecurityPolicy(allow, deny).then((r) => {
      if (r.error) setSaveMsg(r.error);
      else { setSaveMsg(t("security.toast.policySaved")); if (r.summary && policy) setPolicy({ ...policy, allow, deny, summary: r.summary }); }
    }).catch((e) => setSaveMsg(String(e)));
  };
  const saveRules = () => {
    setSaveMsg(null);
    client.saveSecuritySecrets(rules, scanOn).then((r) => {
      if (r.error) setSaveMsg(r.error);
      else { setSaveMsg(t("security.toast.rulesSaved")); if (secrets) setSecrets({ ...secrets, custom: r.custom ?? rules }); }
    }).catch((e) => setSaveMsg(String(e)));
  };

  const builtinDeny = policy?.defaults.deny.length ?? 0;
  const builtinKinds = secrets?.defaults.length ?? 0;

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        {t("security.intro")}
        {" "}<code>@digital-threads/loom-security</code>.
      </p>

      <div className="kv">
        <b>{t("security.osSandbox")}</b>
        <span>
          <button className={`btn ${sandbox ? "acc" : ""}`} disabled={sandbox === null}
            onClick={() => { const v = !sandbox; setSandbox(v); client.saveSetting("sandbox.enabled", v).catch(() => setSandbox(!v)); }}>
            {sandbox === null ? "…" : sandbox ? t("security.on") : t("security.off")}
          </button>
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>{t("security.osSandbox.hint1")} <strong>{t("security.osSandbox.hint2")}</strong> {t("security.osSandbox.hint3")} <code>bubblewrap</code>.</span>
        </span>
      </div>

      <div className="kv">
        <b>{t("security.secretScanning")}</b>
        <span>
          <button className={`btn ${scanOn ? "acc" : ""}`} disabled={!secrets} onClick={toggleScan}>
            {!secrets ? "…" : scanOn ? t("security.on") : t("security.off")}
          </button>
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>{t("security.secretScanning.hint")}</span>
        </span>
      </div>

      <div className="kv">
        <b>{t("security.egressEnforce")}</b>
        <span>
          <button className={`btn ${egressEnforce ? "acc" : ""}`} disabled={egressEnforce === null}
            onClick={() => { const v = !egressEnforce; setEgressEnforce(v); client.saveSetting("security.egress.enforce", v).catch(() => setEgressEnforce(!v)); }}>
            {egressEnforce === null ? "…" : egressEnforce ? t("security.on") : t("security.off")}
          </button>
          <span className="muted" style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}>{t("security.egressEnforce.hint")}</span>
        </span>
      </div>
      {egressEnforce ? (
        <div className="kv">
          <b>{t("security.egressAllow")}</b>
          <span>
            <textarea className="inp" rows={6} aria-label={t("security.egressAllow")} value={egressAllow}
              onChange={(e) => setEgressAllow(e.target.value)}
              onBlur={() => client.saveSetting("security.egress.allow", egressAllow.split("\n").map((l) => l.trim()).filter(Boolean)).then(() => setSaveMsg(t("security.toast.policySaved"))).catch((er) => setSaveMsg(String(er)))}
              style={{ width: 320, maxWidth: "100%", fontFamily: "var(--font-mono)" }} />
            <span className="fld-hint" style={{ display: "block" }}>{t("security.egressAllow.hint")}</span>
          </span>
        </div>
      ) : null}

      {policy && secrets ? (
        <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>
          {t("security.summary.label")}: {allow.length} {t("security.summary.allow")} · {deny.length} {t("security.summary.customDeny")} (+{builtinDeny} {t("security.summary.builtin")}) ·
          {" "}{rules.length} {t("security.summary.customRules")} (+{builtinKinds} {t("security.summary.builtin")}) ·
          {" "}{t("security.summary.secretScanning")} {scanOn ? t("security.on") : t("security.off")}
        </div>
      ) : null}

      <div className="stat-row" style={{ marginTop: 14 }}>
        <div className="stat"><div className="big">{count("command")}</div><div className="stat-sub">{t("security.stat.commands")}</div></div>
        <div className="stat"><div className="big">{count("secret")}</div><div className="stat-sub">{t("security.stat.secrets")}</div></div>
        <div className="stat"><div className="big">{count("worktree")}</div><div className="stat-sub">{t("security.stat.worktree")}</div></div>
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>
        {t("security.stat.note")}
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 0 }}>{t("security.commandPolicy.title")}</h3>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
        {t("security.commandPolicy.desc")}
      </div>
      <PatternList title={t("security.commandPolicy.denyTitle")} builtin={policy?.defaults.deny ?? []} items={deny}
        onAdd={(v) => setDeny((d) => [...d, v])} onRemove={(i) => setDeny((d) => d.filter((_, j) => j !== i))}
        placeholder={`${t("security.placeholder.denyPattern")} \\bgit\\s+push\\b`} />
      <PatternList title={t("security.commandPolicy.allowTitle")} items={allow}
        onAdd={(v) => setAllow((a) => [...a, v])} onRemove={(i) => setAllow((a) => a.filter((_, j) => j !== i))}
        placeholder={`${t("security.placeholder.allowPattern")} ^npm\\s+(run|test)`} />
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn acc" disabled={!policy} onClick={savePolicy}>{t("security.action.savePolicy")}</button>
      </div>

      <h3 style={{ marginTop: 18, marginBottom: 0 }}>{t("security.secretRules.title")}</h3>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
        {t("security.secretRules.desc")}
      </div>
      {secrets?.defaults.length ? (
        <ul className="finding-list" style={{ marginTop: 8 }}>
          {secrets.defaults.map((k, i) => (
            <li key={`dk${i}`} className="finding sev-info">
              <span className="finding-sev">{t("security.builtin")}</span>
              <span className="finding-msg">{k}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rules.length ? (
        <ul className="finding-list">
          {rules.map((r, i) => (
            <li key={`cr${i}`} className="finding sev-bug">
              <span className="finding-sev">{r.kind}</span>
              <span className="finding-msg">
                <code className="finding-file">{r.source}</code>
                <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>{t("security.action.remove")}</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <input className="inp" placeholder={t("security.placeholder.kind")} value={ruleKind} onChange={(e) => setRuleKind(e.target.value)} style={{ flex: 1 }} />
        <input className="inp" placeholder={t("security.placeholder.regexSource")} value={ruleSrc} onChange={(e) => setRuleSrc(e.target.value)} style={{ flex: 2 }} />
        <button className="btn sm acc" disabled={!ruleKind.trim() || !ruleSrc.trim() || !isValidRegex(ruleSrc)}
          onClick={() => { setRules((rs) => [...rs, { kind: ruleKind.trim(), source: ruleSrc.trim() }]); setRuleKind(""); setRuleSrc(""); }}>{t("security.action.add")}</button>
      </div>
      {ruleSrc.trim() && !isValidRegex(ruleSrc) ? <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>{t("security.invalidRegex")}</div> : null}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn acc" disabled={!secrets} onClick={saveRules}>{t("security.action.saveRules")}</button>
      </div>
      {saveMsg ? <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>{saveMsg}</div> : null}

      <h3 style={{ marginTop: 18, marginBottom: 0 }}>{t("security.auditTrail.title")}</h3>
      <div className="row" style={{ gap: 6, margin: "8px 0 8px" }}>
        {CATS.map((c) => (
          <button key={c.key} className={`btn sm ${filter === c.key ? "acc" : ""}`} onClick={() => setFilter(c.key)}>
            {t(`security.cat.${c.key}`)}{c.key !== "all" ? ` (${count(c.key)})` : ""}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <StateView kind="empty" msg={t("security.empty.audit")} />
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
