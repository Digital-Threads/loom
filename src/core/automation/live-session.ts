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
  allowedTools?: string[]; // manual/gated — safe set auto-allowed; the rest is denied (surfaced for approval)
  profile?: string; // aimux subscription to run under (else the launcher's default)
}
export type SpawnSession = (opts: SpawnSessionOpts) => ProcLike;

/** One live turn over a session. Resolves with the result text when the turn's
 *  `result` event arrives. */
interface Live {
  proc: ProcLike;
  buf: string;
  pending: ((text: string) => void) | null;
  cost: number;
  denials: string[];
  onChunk?: (chunk: string) => void;
}

/** Extract a readable tool label from a permission_denials entry. */
function denialLabel(d: unknown): string {
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const o = d as { tool_name?: string; tool?: string; name?: string };
    return o.tool_name ?? o.tool ?? o.name ?? JSON.stringify(d);
  }
  return String(d);
}

function userMessage(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";
}

export interface LiveLauncherDeps {
  spawn: SpawnSession;
  /** Max wait for one agent reply before the session is killed and the send
   *  resolves with a timeout marker — so a stuck agent can't hang the pipeline
   *  forever (loom-uxjk). Default 10 min; overridable for tests. */
  replyTimeoutMs?: number;
}

/** A SessionLauncher backed by long-lived processes (one per sessionId). */
export function createLiveSessionLauncher(deps: LiveLauncherDeps): SessionLauncher & {
  /** Cost accumulated for a session (sum of per-turn total_cost_usd). */
  costOf(sessionId: string): number;
  /** Tools the agent tried to use but were denied (await user approval). */
  denialsOf(sessionId: string): string[];
  /** Inject extra guidance into a LIVE session mid-run ("intervene"): writes a
   *  user message to the running process's stdin. No-op if no live process. */
  interject(sessionId: string, text: string): boolean;
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
        let ev: { type?: string; result?: string; total_cost_usd?: number; permission_denials?: unknown[]; message?: { content?: unknown } };
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "assistant" && l.onChunk) { const s = summarizeAssistant(ev.message?.content); if (s) l.onChunk(s); }
        if (ev.type === "result") {
          if (typeof ev.total_cost_usd === "number") l.cost += ev.total_cost_usd;
          for (const d of ev.permission_denials ?? []) { const t = denialLabel(d); if (!l.denials.includes(t)) l.denials.push(t); }
          const resolve = l.pending;
          l.pending = null;
          resolve?.(ev.result ?? "");
        }
      }
    });
    // A dead/errored process must settle any awaiting send, else run() hangs
    // forever (loom-uxjk). Next send respawns via --resume.
    l.proc.on("close", () => { const p = l.pending; l.pending = null; live.delete(sessionId); p?.("⚠ The agent process ended before replying. Re-run the stage."); });
    l.proc.on("error", () => { const p = l.pending; l.pending = null; live.delete(sessionId); p?.("⚠ The agent process errored. Re-run the stage."); });
  }

  function ensure(sessionId: string, resume: boolean, cwd: string | undefined, env: Record<string, string> | undefined, bypassPermissions: boolean | undefined, allowedTools: string[] | undefined, profile: string | undefined): Live {
    const existing = live.get(sessionId);
    if (existing) return existing;
    // No live process: create (resume=false) or recover (resume=true).
    const proc = deps.spawn({ sessionId, resume, cwd, env, bypassPermissions, allowedTools, profile });
    const l: Live = { proc, buf: "", pending: null, cost: 0, denials: [] };
    live.set(sessionId, l);
    attach(sessionId, l);
    return l;
  }

  return {
    async run(prompt, opts) {
      const l = ensure(opts.sessionId, opts.resume, opts.cwd, opts.env, opts.bypassPermissions, opts.allowedTools, opts.profile);
      l.onChunk = opts.onChunk;
      const text = await new Promise<string>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        // Wrap the resolver so a real reply clears the watchdog. A stuck agent
        // call must not hang the pipeline forever — time out, kill the session,
        // and surface it so the stage parks instead of running on (loom-uxjk).
        l.pending = (t: string) => { clearTimeout(timer); resolve(t); };
        timer = setTimeout(() => {
          l.pending = null;
          try { l.proc.kill(); } catch { /* best-effort */ }
          live.delete(opts.sessionId);
          resolve("⏱ The agent did not respond within the time limit — the session was stopped. Re-run the stage or switch the subscription.");
        }, deps.replyTimeoutMs ?? 10 * 60_000);
        l.proc.stdin.write(userMessage(prompt));
      });
      return { text };
    },
    costOf: (sessionId) => live.get(sessionId)?.cost ?? 0,
    denialsOf: (sessionId) => live.get(sessionId)?.denials ?? [],
    interject: (sessionId, text) => {
      const l = live.get(sessionId);
      if (!l) return false;
      l.proc.stdin.write(userMessage(text));
      return true;
    },
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

/** Summarise an assistant message for the live stream: its text PLUS a readable
 *  line per tool call ("→ Edit: src/x.ts", "→ Bash: bun test"). Tool activity is
 *  most of what a long stage (impl) does, so without this the stream looks dead. */
function summarizeAssistant(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const blk = b as { type?: string; text?: unknown; name?: unknown; input?: unknown };
    if (blk.type === "text" && typeof blk.text === "string") parts.push(blk.text);
    else if (blk.type === "tool_use") parts.push(`→ ${toolLabel(blk.name, blk.input)}`);
  }
  return parts.join("\n");
}

/** A short, readable label for a tool call. */
function toolLabel(name: unknown, input: unknown): string {
  const n = typeof name === "string" ? name : "tool";
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const raw = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description ?? o.prompt;
  const arg = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  const brief = arg.length > 80 ? `${arg.slice(0, 80)}…` : arg;
  return brief ? `${n}: ${brief}` : n;
}
