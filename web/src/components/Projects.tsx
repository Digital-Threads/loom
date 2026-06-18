import { useEffect, useState } from "react";
import type { LoomClient, ProjectStat } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";
import { StateView } from "./StateView";
import { toast } from "../toast";

// D3.5 — project dashboard: add projects, see per-project task count + token
// usage. "Default" = the project new tasks default to (and Accounts/Tokens scope).
export function Projects({ client, onSwitched }: { client: LoomClient; onSwitched?: () => void }) {
  const [stats, setStats] = useState<ProjectStat[] | null>(null);
  const [root, setRoot] = useState("");
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    client.projectStats().then(setStats).catch((e) => setErr(String(e)));
  }
  useEffect(refresh, [client]);

  async function add() {
    if (!root.trim()) return;
    setBusy(true);
    try { await client.addProject(root.trim()); setRoot(""); refresh(); toast.success("Project added"); }
    catch (e) { setErr(String(e)); toast.error("Couldn’t add project"); }
    finally { setBusy(false); }
  }
  async function setDefault(id: string) {
    setBusy(true);
    try { await client.setActiveProject(id); refresh(); onSwitched?.(); toast.success("Default project set"); }
    catch (e) { toast.error(`Couldn’t set default: ${e}`); }
    finally { setBusy(false); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Remove project "${name}" from Loom? Tasks and files on disk are not deleted.`)) return;
    setBusy(true);
    try {
      const res = await client.removeProject(id);
      if (res.error) { toast.error(res.error); return; }
      refresh(); toast.success(`Removed: ${name}`);
    } catch (e) { toast.error(`Couldn’t remove: ${e}`); } finally { setBusy(false); }
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!stats) return <StateView kind="loading" />;

  const pct = (u: number, s: number) => (u + s > 0 ? Math.round((s / (u + s)) * 100) : 0);

  return (
    <div className="panel">
      <div className="acct-add" style={{ marginBottom: 12 }}>
        <input className="inp" placeholder="/path/to/repo" value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="btn" onClick={() => setPicking(true)}>Browse…</button>
        <button className="btn acc" disabled={busy} onClick={add}>Add project</button>
      </div>
      <p className="acct-hint">
        Projects are added here or auto-registered when you create a task in a new repo. The <b>default</b> is what new
        tasks pick and what Accounts/Tokens scope to.
      </p>
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRoot(p); setPicking(false); }} />
      ) : null}
      {stats.length === 0 ? (
        <StateView kind="empty" msg="No projects yet — add a repo path above." />
      ) : (
        <table className="tbl">
          <thead><tr><th>Project</th><th className="num">Tasks</th><th className="num">Tokens used</th><th className="num">Saved ≈</th><th></th></tr></thead>
          <tbody>
            {stats.map((p) => (
              <tr key={p.projectId} className={p.active ? "row-active" : ""}>
                <td>
                  {p.name}{p.active ? <span className="chip ok" style={{ marginLeft: 8 }}>default</span> : null}
                  <div className="crumb">{p.root}</div>
                </td>
                <td className="num">{p.tasks}</td>
                <td className="num">{p.used.toLocaleString()}</td>
                <td className="num">{p.saved.toLocaleString()}{p.saved > 0 ? <span className="crumb"> ({pct(p.used, p.saved)}%)</span> : null}</td>
                <td className="acct-act-cell">
                  <div className="acct-actions">
                    {p.active ? <span className="muted" style={{ fontSize: 12 }}>default</span>
                      : <button className="btn sm" disabled={busy} onClick={() => setDefault(p.projectId)}>Set default</button>}
                    {!p.active ? (
                      <button className="btn sm icon-bad" disabled={busy} aria-label={`Remove project ${p.name}`} title="Remove this project from Loom" onClick={() => remove(p.projectId, p.name)}>✕</button>
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
