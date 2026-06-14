import { useEffect, useState } from "react";
import type { LoomClient, ProjectEntry } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";

export function NewTaskModal({
  client,
  onClose,
  onCreated,
}: {
  client: LoomClient;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [description, setDescription] = useState("");
  const [runMode, setRunMode] = useState("gated");
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.projects().then((d) => {
      setProjects(d.projects);
      const active = d.projects.find((p) => p.projectId === d.active) ?? d.projects[0];
      if (active) setRepo(active.root);
    }).catch(() => {});
  }, [client]);

  async function submit() {
    if (!title.trim()) {
      setErr("Title is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await client.create({
        title: title.trim(),
        repo: repo.trim() || undefined,
        branch: branch.trim() || undefined,
        description: description.trim() || undefined,
        run_mode: runMode,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  }

  // repo is in the projects list unless the user browsed to a custom folder.
  const repoInList = projects.some((p) => p.root === repo);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">New task</div>
        <div className="modal-b">
          <label className="fld">
            <span>Title</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add refund endpoint…" />
          </label>
          <label className="fld">
            <span>Repository</span>
            <div className="fld-row" style={{ gap: 8 }}>
              <select
                value={repoInList ? repo : "__custom__"}
                onChange={(e) => e.target.value !== "__custom__" && setRepo(e.target.value)}
                style={{ flex: 1 }}
              >
                {projects.map((p) => (
                  <option key={p.projectId} value={p.root}>{p.name} — {p.root}</option>
                ))}
                {!repoInList && repo ? <option value="__custom__">{repo}</option> : null}
                {projects.length === 0 ? <option value="">no projects — browse…</option> : null}
              </select>
              <button type="button" className="btn" onClick={() => setPicking(true)}>Browse…</button>
            </div>
          </label>
          <label className="fld">
            <span>Branch</span>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </label>
          <label className="fld">
            <span>Description</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to happen…" />
          </label>
          <label className="fld">
            <span>Run mode</span>
            <select value={runMode} onChange={(e) => setRunMode(e.target.value)}>
              <option value="manual">Manual — run each stage yourself</option>
              <option value="gated">Gated — auto-run, stop at approval gates</option>
              <option value="autopilot">Autopilot — run end-to-end</option>
            </select>
          </label>
          {runMode === "autopilot" ? (
            <div className="modal-warn" style={{ fontSize: 12, color: "var(--warn)" }}>
              ⚠ Autopilot grants the agent <b>full access</b> — it runs end-to-end without per-action approval. Use only on a repo you trust.
            </div>
          ) : null}
          {err ? <div className="modal-err">{err}</div> : null}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn acc" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRepo(p); setPicking(false); }} />
      ) : null}
    </div>
  );
}
