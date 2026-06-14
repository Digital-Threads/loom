// Run-manager — owns background runs. The code orchestrator starts a run, gets a
// runId immediately, and the work proceeds asynchronously while events/output
// accumulate in an in-memory record (the board/SSE read from it). State is
// in-memory for the MVP: in-flight runs are lost on restart (durable queue is a
// later concern — noted in the spec). Supports nested runs (parentRunId) so a
// swarm step can fan out child sessions under one parent (L5).

import { randomBytes } from "node:crypto";
import type { LoomEvent } from "../spine/event.js";
import type { LoomEventSink } from "./exec-loop.js";
import { busSink } from "./exec-loop.js";
import type { StepExecutor, ExecRequest, ExecResult } from "./exec-loop.js";

export type RunStatus = "running" | "done" | "failed";

export interface RunRecord<T = unknown> {
  runId: string;
  parentRunId?: string;
  projectId: string;
  status: RunStatus;
  events: LoomEvent[];
  output: string[];
  result?: T;
  error?: string;
}

export interface StartOptions {
  projectId: string;
  parentRunId?: string;
  /** Mirror emitted events to the file event bus (default true). */
  toBus?: boolean;
}

/** The context a run task receives: an event sink and an output appender. */
export interface RunContext {
  emit: LoomEventSink;
  appendOutput: (chunk: string) => void;
  /** loom-isd.13 — register a handler for input injected into the live session
   *  (e.g. write to the agent process's stdin). The host calls sendInput(). */
  onInput: (handler: (data: string) => void) => void;
}

export interface RunManager {
  start<T>(opts: StartOptions, task: (ctx: RunContext) => Promise<T>): string;
  get(runId: string): RunRecord | undefined;
  list(): RunRecord[];
  childrenOf(parentRunId: string): RunRecord[];
  /** Resolves when the run settles — for tests / synchronous callers. */
  wait(runId: string): Promise<RunRecord>;
  /** Inject stdin into a live run (loom-isd.13). Returns false if the run is
   *  unknown or never registered an input handler. */
  sendInput(runId: string, data: string): boolean;
}

function newRunId(): string {
  return `run_${randomBytes(8).toString("hex")}`;
}

export function createRunManager(): RunManager {
  const runs = new Map<string, RunRecord>();
  const settled = new Map<string, Promise<RunRecord>>();
  const inputHandlers = new Map<string, (data: string) => void>();

  return {
    start(opts, task) {
      const runId = newRunId();
      const rec: RunRecord = {
        runId,
        parentRunId: opts.parentRunId,
        projectId: opts.projectId,
        status: "running",
        events: [],
        output: [],
      };
      runs.set(runId, rec);

      const bus = opts.toBus === false ? null : busSink(opts.projectId);
      const ctx: RunContext = {
        emit: (e) => {
          rec.events.push(e);
          bus?.(e);
        },
        appendOutput: (chunk) => rec.output.push(chunk),
        onInput: (handler) => inputHandlers.set(runId, handler),
      };

      settled.set(
        runId,
        task(ctx)
          .then((result) => {
            rec.status = "done";
            rec.result = result;
            return rec;
          })
          .catch((e: unknown) => {
            rec.status = "failed";
            rec.error = e instanceof Error ? e.message : String(e);
            return rec;
          })
          .finally(() => inputHandlers.delete(runId)),
      );
      return runId;
    },
    get: (runId) => runs.get(runId),
    list: () => [...runs.values()],
    childrenOf: (parentRunId) => [...runs.values()].filter((r) => r.parentRunId === parentRunId),
    wait: (runId) => settled.get(runId) ?? Promise.reject(new Error(`unknown run ${runId}`)),
    sendInput: (runId, data) => {
      const handler = inputHandlers.get(runId);
      if (!handler) return false;
      handler(data);
      return true;
    },
  };
}

// ─── L4.8 — step retry policy ────────────────────────────────────────────────
export interface RetryPolicy {
  maxRetries: number; // additional attempts after the first (0 = no retry)
}

/** Wrap an executor so a failing step (non-zero exit or throw) is retried up to
 *  maxRetries times. The last result is returned; exhausted failures stay failed
 *  (the conductor parks them to "needs attention"). */
export function retryingExecutor(inner: StepExecutor, policy: RetryPolicy): StepExecutor {
  return {
    async run(req: ExecRequest): Promise<ExecResult> {
      let last: ExecResult = { exitCode: 1, stderr: "not run" };
      for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
        try {
          last = await inner.run(req);
        } catch (e) {
          last = { exitCode: 1, stderr: (e as Error).message };
        }
        if (last.exitCode === 0) return last;
      }
      return last;
    },
  };
}
