// L4.2 — the wire: start a spec run in the background via the run-manager,
// assembling the real OrchestrateDeps (aimux decomposer + retrying aimux
// executor) and the live router candidates. Returns a runId immediately; the
// run's events stream into the run-manager record (and the bus). Deps/candidates
// are injectable so the wiring is testable without a model/CLI.

import type Database from "better-sqlite3";
import type { SpineIds } from "../spine/ids.js";
import { runSpec, type OrchestrateDeps, type RunSpecResult } from "./orchestrate.js";
import { createAimuxDecomposer } from "./decomposer-aimux.js";
import { createAimuxExecutor } from "./aimux-executor.js";
import { retryingExecutor, type RunManager } from "./run-manager.js";
import { liveCandidates } from "./router-live.js";
import type { RouteCandidate } from "./router.js";
import type { GitRunner } from "../security/sandbox.js";
import { secureExecutor } from "../security/secure-executor.js";

export interface StartSpecRunOptions {
  /** Override the orchestrate deps (decomposer/executor) — for tests. */
  deps?: OrchestrateDeps;
  /** Override the router candidate pool (default: liveCandidates()). */
  candidates?: RouteCandidate[];
  /** Step retry attempts after the first (default 1). */
  maxRetries?: number;
  /** Run in an isolated worktree (security L10). */
  sandbox?: { repoRoot: string; base?: string; git?: GitRunner };
}

export function startSpecRun(
  rm: RunManager,
  db: Database.Database,
  taskId: string,
  spec: string,
  ids: SpineIds,
  opts: StartSpecRunOptions = {},
): string {
  const deps: OrchestrateDeps =
    opts.deps ?? {
      decomposer: createAimuxDecomposer(),
      // retry(secure(aimux)): each attempt is sandboxed-redacted-audited.
      executor: retryingExecutor(secureExecutor(createAimuxExecutor()), {
        maxRetries: opts.maxRetries ?? 1,
      }),
    };
  const candidates = opts.candidates ?? liveCandidates();

  return rm.start<RunSpecResult>({ projectId: ids.projectId }, (ctx) =>
    runSpec(db, deps, taskId, spec, candidates, ids, { emit: ctx.emit, sandbox: opts.sandbox }),
  );
}
