import { useEffect, useState } from "react";
import type { LoomClient, SkillMeta } from "../api";
import { StateView } from "./StateView";
import { Markdown } from "./Markdown";
import { toast } from "../toast";

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
          <input className="skills-search" placeholder="🔍 поиск скиллов…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn acc sm" onClick={() => setCreating(true)}>+ Создать</button>
        </div>
        {shown.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>Ничего не найдено.</div>
        ) : shown.map((s) => (
          <button key={s.name} className={`skill-row ${sel === s.name ? "active" : ""}`} onClick={() => open(s.name)}>
            <div className="skill-name">{s.name}{s.userInvocable ? <span className="skill-inv">invocable</span> : null}</div>
            <div className="skill-desc">{s.description || <span className="muted">—</span>}</div>
          </button>
        ))}
      </div>

      <div className="skills-detail">
        {!sel ? (
          <div className="muted" style={{ padding: 20 }}>Выбери скилл слева, или создай новый.</div>
        ) : (
          <>
            <div className="skills-detail-head">
              <b>{sel}</b>
              {editing ? (
                <span>
                  <button className="btn sm" onClick={() => setEditing(false)}>Отмена</button>
                  <button className="btn acc sm" disabled={busy} onClick={save}>{busy ? "…" : "💾 Сохранить"}</button>
                </span>
              ) : (
                <button className="btn sm" onClick={() => { setDraft(content); setEditing(true); }}>✏ Редактировать</button>
              )}
            </div>
            {editing ? (
              <textarea className="skills-editor" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            ) : (
              <div className="skills-md"><Markdown text={content} /></div>
            )}
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
      .catch((e) => toast.error(`Не удалось создать скилл: ${e}`))
      .finally(() => setBusy(false));
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
        <div className="modal-h">Создать скилл (AI)</div>
        <div className="modal-b">
          <textarea className="skills-editor" style={{ height: 120 }} placeholder="Опиши что должен делать скилл — агент напишет SKILL.md по стандарту…" value={desc} onChange={(e) => setDesc(e.target.value)} />
          {profiles.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <span className="muted" style={{ marginRight: 6 }}>Аккаунт:</span>
              <select value={profile} onChange={(e) => setProfile(e.target.value)}>
                {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : null}
        </div>
        <div className="modal-f">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn acc" disabled={busy || !desc.trim()} onClick={generate}>{busy ? "Генерирую…" : "Создать"}</button>
        </div>
      </div>
    </div>
  );
}
