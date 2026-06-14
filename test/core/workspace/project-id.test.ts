import { describe, it, expect } from "vitest";
import { deriveProjectId, resolveProjectRoot } from "../../../src/core/workspace/project-id.js";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Throwaway project tree under the OS temp dir. Returns the realpath'd root
// so assertions compare canonical paths (matches tj's dunce::canonicalize).
function tmpTree(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-pid-"));
  return realpathSync(d);
}

describe("LP8 deriveProjectId — Loom's own stable label", () => {
  it("id = first 16 hex of the path's sha256 (deterministic function)", () => {
    const p = "/tmp/some/project";
    const expected = createHash("sha256").update(p).digest("hex").slice(0, 16);
    expect(deriveProjectId(p)).toBe(expected);
  });
  it("deterministic and 16 hex chars long", () => {
    const a = deriveProjectId("/tmp/x");
    expect(a).toBe(deriveProjectId("/tmp/x"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("resolveProjectRoot returns an absolute path for a path inside the repo", () => {
    const root = resolveProjectRoot(process.cwd());
    expect(root.startsWith("/")).toBe(true);
  });
  it("resolveProjectRoot returns the path itself for a non-git path", () => {
    expect(resolveProjectRoot("/tmp")).toBe(realpathSync("/tmp"));
  });
});

// F0.1 — единая деривация: воспроизвести алгоритм task-journal project_hash
// (crates/tj-core/src/project_hash.rs): canonicalize(start) → walk-up до маркера
// `.task-journal/` (приоритет) ИЛИ `.git` (файл/дир) иначе start. Без `git` бинаря.
describe("F0.1 resolveProjectRoot matches task-journal project_root", () => {
  it("subdir under a .git dir resolves to the repo root", () => {
    const repo = tmpTree();
    mkdirSync(join(repo, ".git"));
    const sub = join(repo, "src", "foo");
    mkdirSync(sub, { recursive: true });
    expect(resolveProjectRoot(sub)).toBe(repo);
  });

  it(".task-journal/ marker overrides the .git ancestor (own project)", () => {
    const repo = tmpTree();
    mkdirSync(join(repo, ".git"));
    const sub = join(repo, "sub");
    mkdirSync(sub);
    mkdirSync(join(sub, ".task-journal"));
    expect(resolveProjectRoot(sub)).toBe(sub);
    expect(resolveProjectRoot(sub)).not.toBe(repo);
  });

  it("a .git FILE (worktree) is a boundary", () => {
    const wt = tmpTree();
    writeFileSync(join(wt, ".git"), "gitdir: /elsewhere\n");
    const sub = join(wt, "inner");
    mkdirSync(sub);
    expect(resolveProjectRoot(sub)).toBe(wt);
  });

  it("canonicalizes the start path (resolves '..')", () => {
    const repo = tmpTree();
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "src"));
    expect(resolveProjectRoot(join(repo, "src", ".."))).toBe(repo);
  });

  it("project id equals sha256(realpath(root)).slice(0,16) — tj formula", () => {
    const repo = tmpTree();
    mkdirSync(join(repo, ".git"));
    const sub = join(repo, "a", "b");
    mkdirSync(sub, { recursive: true });
    const id = deriveProjectId(resolveProjectRoot(sub));
    const expected = createHash("sha256").update(repo).digest("hex").slice(0, 16);
    expect(id).toBe(expected);
  });

  it("distinct project roots yield distinct ids", () => {
    const a = tmpTree();
    mkdirSync(join(a, ".git"));
    const b = tmpTree();
    mkdirSync(join(b, ".git"));
    expect(deriveProjectId(resolveProjectRoot(a))).not.toBe(
      deriveProjectId(resolveProjectRoot(b)),
    );
  });
});
