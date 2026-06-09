import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

// Resolve the project root: git toplevel of the candidate, otherwise the candidate as-is.
export function resolveProjectRoot(candidate: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: candidate,
      encoding: "utf8",
      timeout: 3000,
    });
    const top = out.trim();
    return top || candidate;
  } catch {
    return candidate;
  }
}

// Loom's own stable workspace label. Does NOT reproduce the task-journal hash.
// The only requirement is determinism (one root -> one id, 16 hex).
export function deriveProjectId(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
}
