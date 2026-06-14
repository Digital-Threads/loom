// Sandbox backend abstraction (L10.1). The default WorktreeBackend isolates each
// run in a git worktree (built on sandbox.ts). A DockerBackend is a bookmark:
// the setting + interface exist so it can be added later without touching
// callers; it is intentionally NOT implemented now.
import {
  prepareWorktree,
  removeWorktree,
  type Worktree,
  type SandboxOptions,
} from "./sandbox.js";

export type SandboxKind = "worktree" | "docker";

export interface SandboxBackend {
  kind: SandboxKind;
  prepare(repoRoot: string, taskId: string, opts?: SandboxOptions): Worktree;
  cleanup(repoRoot: string, taskId: string, opts?: SandboxOptions): void;
}

export const WorktreeBackend: SandboxBackend = {
  kind: "worktree",
  prepare: prepareWorktree,
  cleanup: removeWorktree,
};

/** Resolve the backend for a setting. `docker` is a bookmark — selecting it
 *  throws until implemented, so the choice is explicit rather than silent. */
export function getSandboxBackend(kind: SandboxKind = "worktree"): SandboxBackend {
  if (kind === "docker") throw new Error("docker sandbox backend not implemented (bookmark)");
  return WorktreeBackend;
}

export interface ProcLimits {
  /** Kill the work if it exceeds this wall-clock budget. */
  timeoutMs?: number;
}

/** Run an async unit under a wall-clock limit. Rejects with a timeout error if
 *  it overruns (the caller turns that into a failed step). No limit → passthrough. */
export async function runWithLimits<T>(fn: () => Promise<T>, limits: ProcLimits = {}): Promise<T> {
  if (!limits.timeoutMs) return fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sandbox: timeout after ${limits.timeoutMs}ms`)), limits.timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
