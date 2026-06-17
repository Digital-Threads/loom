import { useEffect, useState } from "react";
import type { LoomClient, SkillMeta } from "../api";
import { StateView } from "./StateView";
import { Markdown } from "./Markdown";
import { toast } from "../toast";

// Split a SKILL.md into its frontmatter fields + body, so the viewer shows a
// clean header (description + invocable badge) instead of raw `---` yaml.
function splitFrontmatter(md: string): { description: string; invocable: boolean; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { description: "", invocable: false, body: md };
  const get = (k: string) => m[1].match(new RegExp(`^${k}:[ \\t]*(.+?)[ \\t]*$`, "m"))?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  return { description: get("description"), invocable: get("user_invocable") === "true", body: m[2].trim() };
}

// L11.3 — Skills: a library of Claude Code skills from ~/.claude/skills.
// List + search on the left, view/edit the SKILL.md on the right, and an
// AI-generate dialog to scaffold a new one.
export function Skills({ client }: { client: LoomClient }) {
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [profiles, setProfiles] = useState<string[]>([]);

  const reload = () => client.skills().then(setSkills).catch((e) => setErr(String(e)));
  useEffect(() => { reload(); client.workspace().then((w) => setProfiles(w.subscriptions.map((s) => s.name).filter(Boolean))).catch(() => {}); }, [client]);

  function open(name: string) {
    setSel(name); setEditing(false); setContent("");
    client.skillGet(name).then((d) => setContent(d.content)).catch((e) => toast.error(`Couldn’t open the skill: ${e}`));
  }
  function save() {
    if (!sel) return;
    setBusy(true);
    client.skillSave(sel, draft).then(() => { setContent(draft); setEditing(false); reload(); })
      .catch((e) => toast.error(`Couldn’t save: ${e}`)).finally(() => setBusy(false));
  }

  if (err) return <StateView kind="error" msg={err} />;
  if (!skills) return <StateView kind="loading" />;

  const shown = skills.filter((s) =>
    !query.trim() || (s.name + " " + s.description).toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="skills">
      <div className="skills-list">
        <div className="skills-head">
          <input className="skills-search" placeholder="🔍 search skills…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn acc sm" onClick={() => setCreating(true)}>+ Create</button>
        </div>
        {shown.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>Nothing found.</div>
        ) : shown.map((s) => (
          <button key={s.name} className={`skill-row ${sel === s.name ? "active" : ""}`} onClick={() => open(s.name)}>
            <div className="skill-name">{s.name}{s.userInvocable ? <span className="skill-inv">invocable</span> : null}</div>
            <div className="skill-desc">{s.description || <span className="muted">—</span>}</div>
          </button>
        ))}
      </div>

      <div className="skills-detail">
        {!sel ? (
          <div className="muted" style={{ padding: 20 }}>Select a skill on the left, or create a new one.</div>
        ) : (
          <>
            <div className="skills-detail-head">
              <b>{sel}</b>
              {editing ? (
                <span>
                  <button className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
                  <button className="btn acc sm" disabled={busy} onClick={save}>{busy ? "…" : "💾 Save"}</button>
                </span>
              ) : (
                <button className="btn sm" onClick={() => { setDraft(content); setEditing(true); }}>✏ Edit</button>
              )}
            </div>
            {editing ? (
              <textarea className="skills-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            ) : (() => {
              const fm = splitFrontmatter(content);
              return (
                <>
                  {fm.description ? (
                    <div className="skills-sub">{fm.description}{fm.invocable ? <span className="skill-inv">invocable</span> : null}</div>
                  ) : null}
                  <div className="skills-md"><Markdown text={fm.body} /></div>
                </>
              );
            })()}
          </>
        )}
      </div>

      {creating ? <CreateSkill client={client} profiles={profiles} onClose={() => setCreating(false)} onCreated={(name) => { setCreating(false); reload().then(() => open(name)); }} /> : null}
    </div>
  );
}

function CreateSkill({ client, profiles, onClose, onCreated }: { client: LoomClient; profiles: string[]; onClose: () => void; onCreated: (name: string) => void }) {
  const [desc, setDesc] = useState("");
  const [profile, setProfile] = useState(profiles[0] ?? "");
  const [busy, setBusy] = useState(false);
  function generate() {
    if (!desc.trim()) return;
    setBusy(true);
    client.skillGenerate(desc, profile || undefined)
      .then((r) => onCreated(r.name))
      .catch((e) => toast.error(`Couldn't create the skill: ${e}`))
      .finally(() => setBusy(false));
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-h">Create skill (AI)</div>
        <div className="modal-b">
          <textarea className="skills-editor" style={{ height: 120 }} placeholder="Describe what the skill should do — the agent writes a standards-compliant SKILL.md…" value={desc} onChange={(e) => setDesc(e.target.value)} />
          {profiles.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ marginRight: 6 }}>Account:</span>
              <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : null}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn acc" disabled={busy || !desc.trim()} onClick={generate}>{busy ? "Generating…" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}
