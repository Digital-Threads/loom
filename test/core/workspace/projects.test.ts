import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProjects,
  addProject,
  removeProject,
  activeProject,
  setActiveProject,
} from "../../../src/core/workspace/projects.js";
import { deriveProjectId, resolveProjectRoot } from "../../../src/core/workspace/project-id.js";

let dir: string;
let file: string;

// Make two real project roots (each its own .git boundary) under a temp dir.
function repo(name: string): string {
  const r = join(dir, name);
  mkdirSync(join(r, ".git"), { recursive: true });
  return r;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-proj-"));
  file = join(dir, "projects.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("projects registry (D3.1)", () => {
  it("adds a project, derives its id, and lists it", () => {
    const r = repo("alpha");
    const e = addProject(r, { file, now: 5 });
    expect(e.projectId).toBe(deriveProjectId(resolveProjectRoot(r)));
    expect(e.name).toBe("alpha");
    expect(e.addedAt).toBe(5);
    expect(listProjects(file).map((p) => p.projectId)).toEqual([e.projectId]);
  });

  it("is idempotent by project_id (same root → same entry, no dup)", () => {
    const r = repo("alpha");
    const a = addProject(r, { file });
    const b = addProject(join(r, "src"), { file }); // subdir → same root → same id
    expect(b.projectId).toBe(a.projectId);
    expect(listProjects(file)).toHaveLength(1);
  });

  it("first added project becomes active", () => {
    const a = addProject(repo("alpha"), { file });
    addProject(repo("beta"), { file });
    expect(activeProject(file)?.projectId).toBe(a.projectId);
  });

  it("setActiveProject switches; unknown id → false", () => {
    addProject(repo("alpha"), { file });
    const b = addProject(repo("beta"), { file });
    expect(setActiveProject(b.projectId, file)).toBe(true);
    expect(activeProject(file)?.projectId).toBe(b.projectId);
    expect(setActiveProject("nope", file)).toBe(false);
  });

  it("removeProject drops it and reassigns active", () => {
    const a = addProject(repo("alpha"), { file });
    const b = addProject(repo("beta"), { file });
    removeProject(a.projectId, file); // a was active
    expect(listProjects(file).map((p) => p.projectId)).toEqual([b.projectId]);
    expect(activeProject(file)?.projectId).toBe(b.projectId);
  });

  it("missing file → empty list / null active", () => {
    expect(listProjects(file)).toEqual([]);
    expect(activeProject(file)).toBeNull();
  });
});
