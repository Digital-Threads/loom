import { useEffect, useState } from "react";
import type { LoomClient, ProjectEntry } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";
import { StateView } from "./StateView";
import { toast } from "../toast";

// D3.5 — project registry: list projects, add by path, switch the active one.
export function Projects({ client, onSwitched }: { client: LoomClient; onSwitched?: () => void }) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [root, setRoot] = useState("");
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    client.projects().then((d) => { setProjects(d.projects); setActive(d.active); }).catch((e) => setErr(String(e)));
  }
  useEffect(refresh, [client]);

  async function add() {
    if (!root.trim()) return;
    setBusy(true);
    try { await client.addProject(root.trim()); setRoot(""); refresh(); toast.success("Project added"); }
    catch (e) { setErr(String(e)); toast.error("Couldn’t add project"); }
    finally { setBusy(false); }
  }
  async function switchTo(id: string) {
    setBusy(true);
    try { await client.setActiveProject(id); setActive(id); onSwitched?.(); toast.success("Switched project"); }
    finally { setBusy(false); }
  }

  if (err) return <StateView kind="error" msg={err} />;

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8 }}>
        <input className="inp" placeholder="/path/to/repo" value={root} onChange={(e) => setRoot(e.target.value)} />
        <button className="btn" onClick={() => setPicking(true)}>Browse…</button>
        <button className="btn acc" disabled={busy} onClick={add}>Add project</button>
      </div>
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRoot(p); setPicking(false); }} />
      ) : null}
      {projects.length === 0 ? (
        <StateView kind="empty" msg="No projects yet — add a repo path above." />
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
