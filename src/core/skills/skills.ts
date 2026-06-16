// Skills library — browse / read / edit / AI-generate Claude Code skills from
// the global skills folder (~/.claude/skills). A skill is either a directory
// with a SKILL.md (name = dir name) or a bare *.md file (name = file basename).
// Only the global folder for now (plugin/project sources are a later add).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export function skillsRoot(): string {
  return join(homedir(), ".claude", "skills");
}

export interface SkillMeta {
  /** Display/lookup name — frontmatter `name`, else the dir/file basename. */
  name: string;
  description: string;
  userInvocable: boolean;
  /** Absolute path to the SKILL.md / bare .md. */
  file: string;
  kind: "dir" | "file";
}

/** A skill name is used to build a filesystem path, so it must be a plain slug —
 *  never `..` or a leading dash (defends against path traversal / flag smuggling). */
const VALID_NAME = /^[A-Za-z0-9._-]+$/;
function safeName(name: string): boolean {
  return VALID_NAME.test(name) && !name.startsWith("-") && !name.includes("..");
}

/** Parse the leading YAML-ish frontmatter for the fields skills declare. */
function parseFrontmatter(text: string): { name?: string; description?: string; userInvocable?: boolean } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = m[1];
  const get = (k: string) => fm.match(new RegExp(`^${k}:[ \\t]*(.+?)[ \\t]*$`, "m"))?.[1]?.replace(/^["']|["']$/g, "");
  return { name: get("name"), description: get("description") ?? "", userInvocable: get("user_invocable") === "true" };
}

function metaFrom(file: string, fallbackName: string, kind: "dir" | "file"): SkillMeta {
  const fm = parseFrontmatter(readFileSync(file, "utf8"));
  return { name: fm.name || fallbackName, description: fm.description ?? "", userInvocable: fm.userInvocable ?? false, file, kind };
}

/** List every skill under the root (dirs with SKILL.md + bare .md files). */
export function listSkills(root = skillsRoot()): SkillMeta[] {
  if (!existsSync(root)) return [];
  const out: SkillMeta[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      const md = join(p, "SKILL.md");
      if (existsSync(md)) out.push(metaFrom(md, entry, "dir"));
    } else if (entry.toLowerCase().endsWith(".md")) {
      out.push(metaFrom(p, entry.replace(/\.md$/i, ""), "file"));
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve a skill name to its file: dir-based SKILL.md first, then bare .md. */
function resolveFile(name: string, root: string): string | null {
  if (!safeName(name)) return null;
  const dirMd = join(root, name, "SKILL.md");
  if (existsSync(dirMd)) return dirMd;
  const fileMd = join(root, `${name}.md`);
  if (existsSync(fileMd)) return fileMd;
  return null;
}

/** Read a skill's markdown (null if the name is invalid or not found). */
export function readSkill(name: string, root = skillsRoot()): string | null {
  const f = resolveFile(name, root);
  return f ? readFileSync(f, "utf8") : null;
}

/** Save a skill's markdown. Existing skills write back in place; a new name
 *  scaffolds a dir-based skill (<name>/SKILL.md). Returns false on a bad name. */
export function writeSkill(name: string, content: string, root = skillsRoot()): boolean {
  if (!safeName(name)) return false;
  const f = resolveFile(name, root) ?? join(root, name, "SKILL.md");
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content, "utf8");
  return true;
}

/** Strip a surrounding ```markdown fence the agent may wrap the SKILL.md in. */
function unfence(text: string): string {
  const m = text.match(/```(?:markdown|md)?\r?\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

/** Prompt that drives skill generation — a complete SKILL.md with frontmatter. */
export function skillGenPrompt(description: string): string {
  return [
    "Напиши скилл для Claude Code (формат SKILL.md).",
    "Верни ТОЛЬКО содержимое SKILL.md: frontmatter (--- name / description / user_invocable: true ---)",
    "и тело по best practices скиллов (заголовок, когда применять, шаги). name — короткий kebab-case слаг.",
    "Без пояснений вокруг, без ``` — только сам файл.",
    "",
    "Что должен делать скилл:",
    description,
  ].join("\n");
}

/** AI-generate a skill: run the prompt through the injected agent, extract the
 *  frontmatter `name`, and save it. Returns the saved skill (or null on failure). */
export async function generateSkill(
  description: string,
  agent: (prompt: string) => Promise<string>,
  root = skillsRoot(),
): Promise<{ name: string; content: string } | null> {
  const content = unfence(await agent(skillGenPrompt(description)));
  const fm = parseFrontmatter(content);
  if (!fm.name || !safeName(fm.name)) return null;
  writeSkill(fm.name, content, root);
  return { name: fm.name, content };
}
