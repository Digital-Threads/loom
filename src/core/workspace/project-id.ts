import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

// statSync-based existence probes (no throw).
function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Resolve the project root by replicating task-journal's `project_hash::from_path`
// (crates/tj-core/src/project_hash.rs) EXACTLY, so Loom and task-journal derive
// the same project_id for one repo (spine exact-cost join, zero mapping):
//   1. canonicalize the start path (realpath; resolves symlinks and `..`);
//   2. walk up to the first boundary marker, priority order:
//        a) `.task-journal/` directory  — explicit per-subproject opt-in;
//        b) `.git` (file OR dir)        — normal checkouts and worktrees alike;
//   3. fall back to the canonical start if no marker is found.
// Pure filesystem — NO `git` binary — to match tj's behaviour bit-for-bit.
export function resolveProjectRoot(candidate: string): string {
  let start: string;
  try {
    start = realpathSync(candidate);
  } catch {
    start = candidate;
  }
  let cur = start;
  for (;;) {
    if (isDir(join(cur, ".task-journal")) || pathExists(join(cur, ".git"))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) return start;
    cur = parent;
  }
}

// project_id = first 16 hex of sha256(projectRoot bytes). Matches tj's
// `from_path` digest (Sha256, first 8 bytes → 16 hex). Feed it the root from
// `resolveProjectRoot` so the hash is over the canonical project root.
export function deriveProjectId(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
}
