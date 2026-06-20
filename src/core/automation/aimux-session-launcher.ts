// Live launcher: one long-lived Claude session per task, run THROUGH aimux.
//
// Loom does not know Claude or its CLI flags. It asks aimux for a live session on
// a profile (`openSession`) and drives it turn by turn. aimux owns every
// Claude-CLI detail (the `-p` stream-json protocol, `--session-id`/`--resume`,
// `--settings`/`--mcp-config`/permission flags, account relocation). Loom only
// supplies VALUES — which profile/model, the enforce-settings + MCP file paths it
// wrote, the spine env — and tracks per-session degradations for the task.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadActiveProfile, openSession, type LiveSession } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import type { SessionLauncher } from "./task-session.js";
import type { SessionControl } from "./live-session.js";
import { detectSandbox, wrapCommand, sandboxUsable, type OsSandboxBackend } from "../security/os-sandbox.js";
import { startEgressProxy as startEgressProxyImpl, type EgressProxy } from "../security/egress-proxy.js";
import { createEgressObserver } from "../security/egress-audit.js";
import { allowsHost } from "../security/egress-allowlist.js";
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
  /** Start the egress-audit proxy (injectable for tests). Default: the real one. */
  startEgressProxy?: typeof startEgressProxyImpl;
  /** Egress enforcement policy, resolved per session (from settings by the host):
   *  enforce=true refuses hosts off `allow`. Absent → observe-only. */
  egressPolicy?: () => { enforce: boolean; allow: string[] };
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
  const startEgress = deps.startEgressProxy ?? startEgressProxyImpl;
  // One egress-audit proxy per live session, closed when the session stops.
  const egressProxies = new Map<string, EgressProxy>();
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

  async function getOrOpen(opts: RunOpts): Promise<LiveSession> {
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
          let extra = writable;
          if (o.cwd) {
            // The worktree's node_modules is symlinked to the shared install
            // (outside the worktree → read-only under the jail). Build tools the
            // agent runs (vitest → node_modules/.vite-temp, vite → .cache) write
            // there, so bind the RESOLVED node_modules dir writable (loom-ndvo).
            // Trade-off: the shared node_modules becomes writable to the agent —
            // acceptable (it's not credentials, and broken tooling is worse).
            try { extra = [...writable, realpathSync(join(o.cwd, "node_modules"))]; } catch { /* no node_modules */ }
          }
          const w = o.cwd ? wrapCommand(backend, cli, args, o.cwd, extra) : { cli, args };
          return (spawnProcess as unknown as (c: string, a: string[], oo: unknown) => unknown)(w.cli, w.args, o);
        })
      : spawnProcess) as typeof spawn;

    // Egress (loom-xclx): when the security sandbox is on, route the agent's
    // traffic through a local proxy that LOGS each destination host and, when
    // egress enforcement is enabled, REFUSES hosts off the allowlist. Works even
    // where write-confinement is degraded (the proxy is just env). Best-effort: if
    // the proxy can't start, run with direct access rather than break the network.
    let sessionEnv = opts.env;
    if (sandboxOn) {
      try {
        const obs = createEgressObserver({
          projectId: opts.env?.LOOM_PROJECT_ID ?? "default",
          taskId: opts.env?.LOOM_TASK_ID,
        });
        const policy = deps.egressPolicy?.();
        const proxy = await startEgress({
          onHost: obs.onHost,
          onBlock: obs.onBlock,
          allow: policy?.enforce ? (host) => allowsHost(host, policy.allow) : undefined,
        });
        egressProxies.set(opts.sessionId, proxy);
        const url = `http://127.0.0.1:${proxy.port}`;
        sessionEnv = { ...opts.env, HTTP_PROXY: url, HTTPS_PROXY: url, NO_PROXY: "127.0.0.1,localhost" };
      } catch {
        note(opts.sessionId, "egress audit proxy could not start — agent ran with direct network access");
      }
    }

    const session = open(cfg, profile, {
      model: opts.model ?? deps.model,
      sessionId: opts.sessionId,
      resume: opts.resume,
      cwd: opts.cwd,
      env: sessionEnv, // spine env (LOOM_TASK_ID …) + egress-audit proxy when sandboxed
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
      const session = await getOrOpen(opts);
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
      egressProxies.get(sessionId)?.close();
      egressProxies.delete(sessionId);
    },
    degradedOf: (sessionId) => degraded.get(sessionId) ?? [],
  };
}
