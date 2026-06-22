import { useEffect, useState } from "react";
import type { LoomClient, ProjectEntry } from "../api";
import { DirectoryPicker } from "./DirectoryPicker";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { useT } from "../i18n";

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
  const [qaMode, setQaMode] = useState("inherit"); // inherit | minimal | full
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfile] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = useT();

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
      setErr(t("newTask.titleRequired"));
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
        qaMode: qaMode === "inherit" ? undefined : qaMode,
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
    ? t("newTask.repoWarning.none")
    : /(^|\/)(tmp|temp)(\/|$)/i.test(repo)
      ? t("newTask.repoWarning.temp")
      : null;

  return (
    <Modal title={t("newTask.modalTitle")} onClose={onClose}>
        <div className="modal-b">
          <label className="fld">
            <span>{t("newTask.title")}</span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("newTask.title.placeholder")} />
          </label>
          <label className="fld">
            <span>{t("newTask.repository")}</span>
            <div className="fld-row" style={{ gap: 8 }}>
              <Select
                block
                wrapStyle={{ flex: 1 }}
                value={repoInList ? repo : "__custom__"}
                onChange={(e) => e.target.value !== "__custom__" && setRepo(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.projectId} value={p.root}>{p.name} — {p.root}</option>
                ))}
                {!repoInList && repo ? <option value="__custom__">{repo}</option> : null}
                {projects.length === 0 ? <option value="">{t("newTask.noProjects")}</option> : null}
              </Select>
              <button type="button" className="btn" onClick={() => setPicking(true)}>{t("newTask.browse")}</button>
            </div>
            {repoWarning ? <span className="fld-warn">⚠ {repoWarning}</span> : null}
          </label>
          <label className="fld">
            <span>{t("newTask.branch")}</span>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </label>
          <label className="fld">
            <span>{t("newTask.description")}</span>
            <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("newTask.description.placeholder")} />
          </label>
          <label className="fld">
            <span>{t("newTask.runMode")}</span>
            <Select block value={runMode} onChange={(e) => setRunMode(e.target.value)}>
              <option value="manual">{t("newTask.runMode.manual")}</option>
              <option value="gated">{t("newTask.runMode.gated")}</option>
              <option value="autopilot">{t("newTask.runMode.autopilot")}</option>
            </Select>
          </label>
          <label className="fld">
            <span>{t("newTask.qaDepth")}</span>
            <Select block value={qaMode} onChange={(e) => setQaMode(e.target.value)}>
              <option value="inherit">{t("newTask.qaDepth.inherit")}</option>
              <option value="minimal">{t("newTask.qaDepth.minimal")}</option>
              <option value="full">{t("newTask.qaDepth.full")}</option>
            </Select>
            <span className="fld-hint">{t("newTask.qaDepth.hint")}</span>
          </label>
          {profiles.length ? (
            <label className="fld">
              <span>{t("newTask.account")}</span>
              <Select block value={profile} onChange={(e) => setProfile(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
              <span className="fld-hint">{t("newTask.account.hint")}</span>
            </label>
          ) : null}
          {runMode === "autopilot" ? (
            <div className="modal-warn">
              ⚠ {t("newTask.autopilotWarning.before")}<b>{t("newTask.autopilotWarning.fullAccess")}</b>{t("newTask.autopilotWarning.mid")}<b>{t("newTask.autopilotWarning.not")}</b>{t("newTask.autopilotWarning.after")}
            </div>
          ) : null}
          {err ? <div className="modal-err">{err}</div> : null}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onClose} disabled={busy}>{t("action.cancel")}</button>
          <button className="btn acc" onClick={submit} disabled={busy}>
            {busy ? t("newTask.creating") : t("action.create")}
          </button>
        </div>
      {picking ? (
        <DirectoryPicker client={client} onCancel={() => setPicking(false)} onPick={(p) => { setRepo(p); setPicking(false); }} />
      ) : null}
    </Modal>
  );
}
