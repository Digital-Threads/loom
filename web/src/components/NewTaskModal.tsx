import { useEffect, useState } from "react";
import type { LoomClient, ProjectEntry } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";
import { Modal } from "./Modal";

export function NewTaskModal({
  client,
  onClose,
  onCreated,
  defaultProjectId,
}: {
  client: LoomClient;
  onClose: () => void;
  onCreated: () => void;
  defaultProjectId?: string; // board filter → preselect this project's repo
}) {
  const [title, setTitle] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [description, setDescription] = useState("");
  const [runMode, setRunMode] = useState("gated");
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfile] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    client.projects().then((d) => {
      setProjects(d.projects);
      // Default to the board-filtered project if set, else the active one.
      const pick = (defaultProjectId && d.projects.find((p) => p.projectId === defaultProjectId))
        ?? d.projects.find((p) => p.projectId === d.active) ?? d.projects[0];
      if (pick) setRepo(pick.root);
    }).catch(() => {});
    // Subscriptions to choose which account the task runs under (default = active).
    client.workspace().then((w) => {
      setProfiles(w.subscriptions.map((s) => s.name).filter(Boolean));
      if (w.activeProfile) setProfile(w.activeProfile);
    }).catch(() => {});
    // Seed the run-mode select from the global default (Settings → Default run mode).
    client.settings().then((s) => { const m = s["run_mode"]; if (typeof m === "string") setRunMode(m); }).catch(() => {});
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
        profile: profile || undefined,
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
  // surface the trap that silently bound a task to a throwaway folder: warn when
  // no repo is chosen or it looks like a temp dir, so the agent isn't pointed at
  // empty/scratch code.
  const repoWarning = !repo.trim()
    ? "No project selected — Browse to your code folder, or the agent will have nothing to work on."
    : /(^|\/)(tmp|temp)(\/|$)/i.test(repo)
      ? "This looks like a temporary folder. Pick your real project unless you meant a scratch repo."
      : null;

  return (
    <Modal title="New task" onClose={onClose}>
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
            {repoWarning ? <span className="fld-warn">⚠ {repoWarning}</span> : null}
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
          {profiles.length ? (
            <label className="fld">
              <span>Account</span>
              <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <span className="fld-hint">Subscription this task runs under. You can switch it any time while it runs.</span>
            </label>
          ) : null}
          {runMode === "autopilot" ? (
            <div className="modal-warn">
              ⚠ Autopilot grants the agent <b>full host access</b> — it runs end-to-end without per-action approval and is <b>not</b> confined unless the OS sandbox is on. Enable the sandbox (Settings) to isolate it, or use only on a repo you trust.
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
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRepo(p); setPicking(false); }} />
      ) : null}
    </Modal>
  );
}
