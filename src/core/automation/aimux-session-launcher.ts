// Live launcher: one long-lived Claude session per task, run THROUGH aimux.
//
// Loom does not know Claude or its CLI flags. It asks aimux for a live session on
// a profile (`openSession`) and drives it turn by turn. aimux owns every
// Claude-CLI detail (the `-p` stream-json protocol, `--session-id`/`--resume`,
// `--settings`/`--mcp-config`/permission flags, account relocation). Loom only
// supplies VALUES — which profile/model, the enforce-settings + MCP file paths it
// wrote, the spine env — and tracks per-session degradations for the task.

import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadActiveProfile, openSession, type LiveSession } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import type { SessionLauncher } from "./task-session.js";
import type { SessionControl } from "./live-session.js";
import { detectSandbox, wrapCommand, sandboxUsable, type OsSandboxBackend } from "../security/os-sandbox.js";
import { enforcedSettingsPath, tokenPilotOnPath, enforcedSettingsWriteFailed } from "./enforced-settings.js";
import { listMcp as listMcpServers, writeMcpRunConfig, type McpServer } from "../connectors/mcp.js";

export interface AimuxLiveLauncherDeps {
  loadConfig?: typeof loadConfig;
  /** Open a live session (injectable for tests). Default: aimux openSession. */
  openSession?: typeof openSession;
  profile?: string;
  model?: string;
  /** EXPERIMENTAL: confine writes to the worktree (cwd) via an OS sandbox. A
   *  function is resolved per session so a Settings toggle takes effect next run. */
  sandbox?: boolean | (() => boolean);
  /** Detect the available OS-sandbox backend (injectable for tests). */
  detectSandbox?: () => OsSandboxBackend;
  /** Verify the backend can actually run the agent (injectable for tests). */
  sandboxUsable?: (backend: OsSandboxBackend, cli: string) => boolean;
  /** Source of the user's MCP registry (default: ~/.loom/mcp.json). */
  listMcp?: () => McpServer[];
  /** Write the enabled servers to a run-config file, return its path (or null). */
  writeMcpRunConfig?: (servers: McpServer[]) => string | null;
  /** Spawn the child process (injectable for tests). Default: node spawn. */
  spawnProcess?: typeof spawn;
}

interface RunOpts {
  sessionId: string;
  resume: boolean;
  /** Model for this stage's lane (per-stage policy). Falls back to deps.model. */
  model?: string;
  cwd?: string;
  env?: Record<string, string>;
  bypassPermissions?: boolean;
  allowedTools?: string[];
  onChunk?: (chunk: string) => void;
  profile?: string;
  /** Confine the agent's writes to the worktree via the OS sandbox for THIS run
   *  (per-task override — autopilot forces it on). Falls back to deps.sandbox. */
  sandbox?: boolean;
}

/** A LiveSession that yields one empty turn — used when there is no aimux
 *  config/profile, so the pipeline degrades gracefully instead of hanging. */
function emptySession(): LiveSession {
  return {
    send: async () => ({ text: "", costUsd: 0, denials: [] }),
    interject: () => false,
    relocate: () => {},
    cost: () => 0,
    denials: () => [],
    close: () => {},
  };
}

export function createAimuxLiveLauncher(deps: AimuxLiveLauncherDeps = {}): SessionLauncher & SessionControl {
  // Preflight: without token-pilot on PATH the enforced --settings hooks fail and
  // sessions fall back to raw reads. Surface it once instead of degrading quietly.
  const tokenPilotMissing = !tokenPilotOnPath();
  if (tokenPilotMissing) {
    console.warn("[loom] token-pilot is NOT on PATH — sessions will run WITHOUT enforced token-efficient tools");
  }

  const load = deps.loadConfig ?? loadConfig;
  const open = deps.openSession ?? openSession;
  const listMcp = deps.listMcp ?? listMcpServers;
  const writeMcp = deps.writeMcpRunConfig ?? writeMcpRunConfig;
  const spawnProcess = deps.spawnProcess ?? spawn;

  const sessions = new Map<string, LiveSession>();
  // Per-session degradations detected at open time (MCP not loaded, token-pilot
  // enforcement missing). Drained by the host after a send and attributed to the
  // task, so a "green" run can't hide that it ran weaker than asked.
  const degraded = new Map<string, string[]>();
  const note = (sid: string, what: string): void => {
    const list = degraded.get(sid) ?? [];
    if (!list.includes(what)) { list.push(what); degraded.set(sid, list); }
  };

  function getOrOpen(opts: RunOpts): LiveSession {
    const existing = sessions.get(opts.sessionId);
    if (existing) return existing;

    const cfg = load();
    // Which subscription runs this session: the task's profile (per-run) → dep →
    // the user's active profile → first subscription.
    const profile = opts.profile ?? deps.profile ?? loadActiveProfile() ?? listSubscriptions()[0]?.name;
    if (!cfg || !profile) return emptySession();

    // The user's enabled MCP servers, written to a run-config file; aimux gets the
    // PATH (it owns the --mcp-config flag). Best-effort: a write failure must not
    // break the spawn, but it IS recorded as a degradation.
    let mcpConfigPath: string | undefined;
    try {
      mcpConfigPath = writeMcp(listMcp()) ?? undefined;
    } catch {
      note(opts.sessionId, "MCP servers not loaded (config write failed)");
    }
    if (enforcedSettingsWriteFailed()) note(opts.sessionId, "token-pilot enforcement settings not written");
    if (tokenPilotMissing) note(opts.sessionId, "token-pilot not on PATH — session ran without enforced tools");

    // OS sandbox: confine the agent's writes to the worktree (cwd) via bubblewrap/
    // sandbox-exec. Stays a Loom concern by injecting a wrapping spawnFn — aimux
    // just spawns what it's given. The per-task flag (opts.sandbox, set on by
    // autopilot) wins over the global Settings toggle (deps.sandbox).
    const sandboxOn = opts.sandbox ?? (typeof deps.sandbox === "function" ? deps.sandbox() : !!deps.sandbox);
    const detect = deps.detectSandbox ?? detectSandbox;
    const usable = deps.sandboxUsable ?? sandboxUsable;
    let backend = sandboxOn ? detect() : "none";
    if (sandboxOn && backend === "none") {
      // No backend at all (no bwrap / Windows / WSL without bubblewrap).
      note(opts.sessionId, "OS sandbox unavailable (install bubblewrap) — agent ran without write-confinement");
    } else if (sandboxOn && !usable(backend, "claude")) {
      // Backend present but it can't run the agent on this platform (e.g. the
      // Bun-based claude crashes under it) — degrade rather than break the agent.
      note(opts.sessionId, "OS sandbox can't run the agent on this platform — agent ran without write-confinement");
      backend = "none";
    }
    // Carve-outs the agent's own tooling legitimately writes under a read-only
    // root: Claude's session-state dir (--resume), the aimux profiles, the XDG
    // data dir (task-journal's SQLite + events), the XDG cache dir (token-pilot's
    // ast-index, claude-cli MCP logs), and tmp. The jail still protects ~/.ssh,
    // ~/.config (gh/aws creds), dotfiles, /etc, /usr and the real repo outside the
    // worktree. (XDG_DATA_HOME/XDG_CACHE_HOME override the defaults when set.)
    const writable = [
      join(homedir(), ".claude"),
      join(homedir(), ".aimux"),
      process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
      tmpdir(),
    ];
    const spawnFn = (backend !== "none"
      ? ((cli: string, args: string[], o: { cwd?: string }) => {
          const w = o.cwd ? wrapCommand(backend, cli, args, o.cwd, writable) : { cli, args };
          return (spawnProcess as unknown as (c: string, a: string[], oo: unknown) => unknown)(w.cli, w.args, o);
        })
      : spawnProcess) as typeof spawn;

    const session = open(cfg, profile, {
      model: opts.model ?? deps.model,
      sessionId: opts.sessionId,
      resume: opts.resume,
      cwd: opts.cwd,
      env: opts.env, // spine env (LOOM_TASK_ID …) so plugin telemetry ties to the task
      settingsPath: enforcedSettingsPath(),
      mcpConfigPath,
      allowedTools: opts.allowedTools,
      bypassPermissions: opts.bypassPermissions,
      spawnFn,
    });
    sessions.set(opts.sessionId, session);
    return session;
  }

  return {
    async run(prompt, opts) {
      const session = getOrOpen(opts);
      // Stream assistant text/tool activity to the live view as it arrives.
      const onEvent = opts.onChunk
        ? (e: { kind: string; text?: string }) => { if (e.kind === "assistant" && e.text) opts.onChunk!(e.text); }
        : undefined;
      const r = await session.send(prompt, onEvent);
      return { text: r.text };
    },
    costOf: (sessionId) => sessions.get(sessionId)?.cost() ?? 0,
    denialsOf: (sessionId) => sessions.get(sessionId)?.denials() ?? [],
    interject: (sessionId, text) => sessions.get(sessionId)?.interject(text) ?? false,
    stop: (sessionId) => {
      const s = sessions.get(sessionId);
      if (s) { s.close(); sessions.delete(sessionId); }
    },
    degradedOf: (sessionId) => degraded.get(sessionId) ?? [],
  };
}
