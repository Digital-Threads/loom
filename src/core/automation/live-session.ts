// Live session launcher — keeps ONE long-lived Claude process alive per task
// while it's active and injects each stage's message into its stdin (stream-json
// multi-turn). No --resume between steps (that re-reads history + cold-starts);
// --resume is only used to RECOVER when the process is gone (host restart, crash,
// long idle). Verified protocol: `claude -p --verbose --input-format stream-json
// --output-format stream-json --session-id <uuid>`; input lines are
// {"type":"user","message":{role,content}}; a turn ends on a {"type":"result"}
// event carrying the text + session_id + total_cost_usd.

import type { SessionLauncher } from "./task-session.js";

/** Minimal child-process surface (real: node child_process; tests: a fake). */
export interface ProcLike {
  stdin: { write(s: string): void; end(): void };
  stdout: { on(ev: "data", cb: (d: string | Buffer) => void): void };
  on(ev: "close" | "error", cb: (arg?: unknown) => void): void;
  kill(): void;
}

export interface SpawnSessionOpts {
  sessionId: string;
  resume: boolean; // true → spawn with --resume (recovery); false → --session-id (create)
  cwd?: string;
  env?: Record<string, string>; // spine env (LOOM_TASK_ID …) so plugin telemetry attributes to the task
  bypassPermissions?: boolean; // autopilot only — full access, user-warned at task creation
}
export type SpawnSession = (opts: SpawnSessionOpts) => ProcLike;

/** One live turn over a session. Resolves with the result text when the turn's
 *  `result` event arrives. */
interface Live {
  proc: ProcLike;
  buf: string;
  pending: ((text: string) => void) | null;
  cost: number;
  onChunk?: (chunk: string) => void;
}

function userMessage(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";
}

export interface LiveLauncherDeps {
  spawn: SpawnSession;
}

/** A SessionLauncher backed by long-lived processes (one per sessionId). */
export function createLiveSessionLauncher(deps: LiveLauncherDeps): SessionLauncher & {
  /** Cost accumulated for a session (sum of per-turn total_cost_usd). */
  costOf(sessionId: string): number;
  /** Stop a session's process (e.g. on task done). */
  stop(sessionId: string): void;
} {
  const live = new Map<string, Live>();

  function attach(sessionId: string, l: Live) {
    l.proc.stdout.on("data", (d) => {
      l.buf += d.toString();
      let i: number;
      while ((i = l.buf.indexOf("\n")) >= 0) {
        const line = l.buf.slice(0, i);
        l.buf = l.buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev: { type?: string; result?: string; total_cost_usd?: number; message?: { content?: unknown } };
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "assistant" && l.onChunk) l.onChunk(extractText(ev.message?.content));
        if (ev.type === "result") {
          if (typeof ev.total_cost_usd === "number") l.cost += ev.total_cost_usd;
          const resolve = l.pending;
          l.pending = null;
          resolve?.(ev.result ?? "");
        }
      }
    });
    l.proc.on("close", () => live.delete(sessionId)); // dead → next send respawns via --resume
    l.proc.on("error", () => live.delete(sessionId));
  }

  function ensure(sessionId: string, resume: boolean, cwd: string | undefined, env: Record<string, string> | undefined, bypassPermissions: boolean | undefined): Live {
    const existing = live.get(sessionId);
    if (existing) return existing;
    // No live process: create (resume=false) or recover (resume=true).
    const proc = deps.spawn({ sessionId, resume, cwd, env, bypassPermissions });
    const l: Live = { proc, buf: "", pending: null, cost: 0 };
    live.set(sessionId, l);
    attach(sessionId, l);
    return l;
  }

  return {
    async run(prompt, opts) {
      const l = ensure(opts.sessionId, opts.resume, opts.cwd, opts.env, opts.bypassPermissions);
      l.onChunk = opts.onChunk;
      const text = await new Promise<string>((resolve) => {
        l.pending = resolve;
        l.proc.stdin.write(userMessage(prompt));
      });
      return { text };
    },
    costOf: (sessionId) => live.get(sessionId)?.cost ?? 0,
    stop: (sessionId) => {
      const l = live.get(sessionId);
      if (l) {
        try {
          l.proc.stdin.end();
          l.proc.kill();
        } catch {
          /* best-effort */
        }
        live.delete(sessionId);
      }
    },
  };
}

/** Extract plain text from an assistant message's content blocks. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}
