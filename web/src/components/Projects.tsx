import { useEffect, useState } from "react";
import type { LoomClient, ProjectEntry } from "../api";

// D3.5 — project registry: list projects, add by path, switch the active one.
export function Projects({ client, onSwitched }: { client: LoomClient; onSwitched?: () => void }) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [root, setRoot] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    client.projects().then((d) => { setProjects(d.projects); setActive(d.active); }).catch((e) => setErr(String(e)));
  }
  useEffect(refresh, [client]);

  async function add() {
    if (!root.trim()) return;
    setBusy(true);
    try { await client.addProject(root.trim()); setRoot(""); refresh(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }
  async function switchTo(id: string) {
    setBusy(true);
    try { await client.setActiveProject(id); setActive(id); onSwitched?.(); }
    finally { setBusy(false); }
  }

  if (err) return <div className="empty">Can’t reach the core: {err}</div>;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8 }}>
        <input className="inp" placeholder="/path/to/repo" value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="btn acc" disabled={busy} onClick={add}>Add project</button>
      </div>
      {projects.length === 0 ? (
        <div className="empty">No projects yet — add a repo path above.</div>
      ) : (
        <table className="tbl" style={{ marginTop: 16 }}>
          <thead><tr><th>Project</th><th>Root</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.projectId}>
                <td>{p.name}{p.projectId === active ? <span className="chip ok" style={{ marginLeft: 8 }}>active</span> : null}</td>
                <td className="crumb">{p.root}</td>
                <td>{p.projectId === active ? null : <button className="btn" disabled={busy} onClick={() => switchTo(p.projectId)}>Switch</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
