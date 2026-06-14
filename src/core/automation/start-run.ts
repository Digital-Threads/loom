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
import { recordRunCost } from "../observability/cost-recorder.js";
import { tokenEventsByTime, type TokenEvent } from "../plugins/token-pilot/adapter.js";
import { resolveProjectRoot } from "../workspace/project-id.js";
import { computePriors, outcomesFromEvents } from "../learning/priors.js";
import { loadLoomEvents } from "../spine/event-bus.js";
import type { LoomEvent } from "../spine/event.js";

export interface StartSpecRunOptions {
  /** Override the orchestrate deps (decomposer/executor) — for tests. */
  deps?: OrchestrateDeps;
  /** Override the router candidate pool (default: liveCandidates()). */
  candidates?: RouteCandidate[];
  /** Step retry attempts after the first (default 1). */
  maxRetries?: number;
  /** Run in an isolated worktree (security L10). */
  sandbox?: { repoRoot: string; base?: string; git?: GitRunner };
  /** Token events source for cost recording (default: token-pilot adapter). */
  loadTokenEvents?: () => TokenEvent[];
  /** Event source for learning priors (default: project event bus). */
  loadEvents?: () => LoomEvent[];
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
  const loadTokenEvents =
    opts.loadTokenEvents ??
    (() => tokenEventsByTime(opts.sandbox?.repoRoot ?? resolveProjectRoot(process.cwd())));

  // learning (L8): bias routing by past outcomes from the event history.
  const priorEvents = opts.loadEvents ? opts.loadEvents() : loadLoomEvents(ids.projectId);
  const priors = computePriors(outcomesFromEvents(priorEvents));

  return rm.start<RunSpecResult>({ projectId: ids.projectId }, async (ctx) => {
    const result = await runSpec(db, deps, taskId, spec, candidates, ids, {
      emit: ctx.emit,
      sandbox: opts.sandbox,
      priors,
    });
    // provод 4 — record cost on completion (exact via spine task_id tagging).
    if (ids.taskId) recordRunCost(db, ids.taskId, { tokenEvents: loadTokenEvents() });
    return result;
  });
}
