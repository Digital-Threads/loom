import { useState } from "react";
import type { LoomClient } from "../api";

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">New task</div>
        <div className="modal-b">
          <label className="fld">
            <span>Title</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add refund endpoint…" />
          </label>
          <div className="fld-row">
            <label className="fld">
              <span>Repo</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="payments-api" />
            </label>
            <label className="fld">
              <span>Branch</span>
              <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </label>
          </div>
          <label className="fld">
            <span>Description</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs to happen…" />
          </label>
          <label className="fld">
            <span>Gate preset</span>
            <select value={runMode} onChange={(e) => setRunMode(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="gated">Gated</option>
              <option value="autopilot">Autopilot</option>
            </select>
          </label>
          {err ? <div className="modal-err">{err}</div> : null}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn acc" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
