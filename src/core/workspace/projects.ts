import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { loomProjectsFile } from "../paths.js";
import { resolveProjectRoot, deriveProjectId } from "./project-id.js";

// The set of projects the user has added to Loom. Each project = one Loom
// workspace = one core-store db (~/.loom/state/<projectId>.db). The registry
// lets the UI list/switch projects; project_id is the task-journal-aligned hash
// of the resolved repo root, so the same repo always maps to the same project.
export interface ProjectEntry {
  projectId: string;
  root: string;       // canonical project root (resolveProjectRoot)
  name: string;       // display name (defaults to the root's basename)
  type?: string;      // project type → sandbox profile (D3.4 / L10)
  addedAt: number;    // epoch ms
}

interface ProjectsFile {
  version: 1;
  active: string | null; // active projectId
  projects: ProjectEntry[];
}

// Always returns a FRESH object with its own arrays — never a shared reference,
// so callers that mutate data.projects can't pollute a module-level default.
function read(file: string): ProjectsFile {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectsFile>;
    return {
      version: 1,
      active: typeof raw.active === "string" ? raw.active : null,
      projects: Array.isArray(raw.projects) ? (raw.projects as ProjectEntry[]) : [],
    };
  } catch {
    return { version: 1, active: null, projects: [] };
  }
}

function write(file: string, data: ProjectsFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function listProjects(file: string = loomProjectsFile()): ProjectEntry[] {
  return read(file).projects;
}

/** Add (or return the existing) project for a path. Resolves the root and
 *  derives the project_id; idempotent by project_id. The first project added
 *  becomes active. `now` is injectable for deterministic tests. */
export function addProject(
  root: string,
  opts: { name?: string; type?: string; now?: number; file?: string } = {},
): ProjectEntry {
  const file = opts.file ?? loomProjectsFile();
  const data = read(file);
  const canonical = resolveProjectRoot(root);
  const projectId = deriveProjectId(canonical);
  const existing = data.projects.find((p) => p.projectId === projectId);
  if (existing) return existing;
  const entry: ProjectEntry = {
    projectId,
    root: canonical,
    name: opts.name ?? (basename(canonical) || canonical),
    type: opts.type,
    addedAt: opts.now ?? 0,
  };
  data.projects.push(entry);
  if (data.active === null) data.active = projectId;
  write(file, data);
  return entry;
}

export function removeProject(projectId: string, file: string = loomProjectsFile()): void {
  const data = read(file);
  data.projects = data.projects.filter((p) => p.projectId !== projectId);
  if (data.active === projectId) data.active = data.projects[0]?.projectId ?? null;
  write(file, data);
}

export function activeProject(file: string = loomProjectsFile()): ProjectEntry | null {
  const data = read(file);
  return data.projects.find((p) => p.projectId === data.active) ?? null;
}

export function setActiveProject(projectId: string, file: string = loomProjectsFile()): boolean {
  const data = read(file);
  if (!data.projects.some((p) => p.projectId === projectId)) return false;
  data.active = projectId;
  write(file, data);
  return true;
}
