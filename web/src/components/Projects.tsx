import { useEffect, useState } from "react";
import type { LoomClient, ProjectStat } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";
import { StateView } from "./StateView";
import { toast } from "../toast";
import { useT } from "../i18n";

// D3.5 — project dashboard: add projects, see per-project task count + token
// usage. "Default" = the project new tasks default to (and Accounts/Tokens scope).
export function Projects({ client, onSwitched }: { client: LoomClient; onSwitched?: () => void }) {
  const t = useT();
  const [stats, setStats] = useState<ProjectStat[] | null>(null);
  const [root, setRoot] = useState("");
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    client.projectStats().then((s) => { setStats(s); setErr(null); }).catch((e) => setErr(String(e)));
  }
  useEffect(refresh, [client]);

  async function add() {
    if (!root.trim()) return;
    setBusy(true);
    try { await client.addProject(root.trim()); setRoot(""); refresh(); toast.success(t("projects.toast.added")); }
    catch { toast.error(t("projects.toast.addFailed")); } // mutation failure → toast only, never the fatal panel
    finally { setBusy(false); }
  }
  async function setDefault(id: string) {
    setBusy(true);
    try { await client.setActiveProject(id); refresh(); onSwitched?.(); toast.success(t("projects.toast.defaultSet")); }
    catch (e) { toast.error(`${t("projects.toast.setDefaultFailed")}: ${e}`); }
    finally { setBusy(false); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`${t("projects.confirmRemovePre")} "${name}" ${t("projects.confirmRemovePost")}`)) return;
    setBusy(true);
    try {
      const res = await client.removeProject(id);
      if (res.error) { toast.error(res.error); return; }
      refresh(); toast.success(`${t("projects.toast.removed")}: ${name}`);
    } catch (e) { toast.error(`${t("projects.toast.removeFailed")}: ${e}`); } finally { setBusy(false); }
  }

  if (err) return (
    <div className="panel">
      <StateView kind="error" msg={err} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn acc" onClick={refresh}>{t("action.retry")}</button>
      </div>
    </div>
  );
  if (!stats) return <StateView kind="loading" />;

  const pct = (u: number, s: number) => (u + s > 0 ? Math.round((s / (u + s)) * 100) : 0);

  return (
    <div className="panel">
      <div className="acct-add" style={{ marginBottom: 12 }}>
        <input className="inp" aria-label={t("projects.repoPathAria")} value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="btn" onClick={() => setPicking(true)}>{t("projects.browse")}</button>
        <button className="btn acc" disabled={busy || !root.trim()} onClick={add}>{t("projects.addProject")}</button>
      </div>
      <p className="acct-hint">
        {t("projects.hintPre")} <b>{t("projects.hintDefault")}</b> {t("projects.hintPost")}
      </p>
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRoot(p); setPicking(false); }} />
      ) : null}
      {stats.length === 0 ? (
        <StateView kind="empty" msg={t("projects.empty")} />
      ) : (
        <table className="tbl">
          <thead><tr><th>{t("projects.col.project")}</th><th className="num">{t("projects.col.tasks")}</th><th className="num">{t("projects.col.tokensUsed")}</th><th className="num">{t("projects.col.saved")}</th><th></th></tr></thead>
          <tbody>
            {stats.map((p) => (
              <tr key={p.projectId} className={p.active ? "row-active" : ""}>
                <td>
                  {p.name}{p.active ? <span className="chip ok" style={{ marginLeft: 8 }}>{t("projects.default")}</span> : null}
                  <div className="crumb">{p.root}</div>
                </td>
                <td className="num">{p.tasks}</td>
                <td className="num">{p.used.toLocaleString()}</td>
                <td className="num">{p.saved.toLocaleString()}{p.saved > 0 ? <span className="crumb"> ({pct(p.used, p.saved)}%)</span> : null}</td>
                <td className="acct-act-cell">
                  <div className="acct-actions">
                    {p.active ? <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>{t("projects.default")}</span>
                      : <button className="btn sm" disabled={busy} onClick={() => setDefault(p.projectId)}>{t("projects.setDefault")}</button>}
                    {!p.active ? (
                      <button className="btn sm icon-bad" disabled={busy} aria-label={`${t("projects.removeAria")} ${p.name}`} title={t("projects.removeTitle")} onClick={() => remove(p.projectId, p.name)}>✕</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
