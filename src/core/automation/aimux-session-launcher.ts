// Real live launcher: spawns a long-lived Claude process per task session via
// aimux's buildRunParams (public — aimux unchanged) and drives it with the
// verified stream-json multi-turn protocol. --session-id on create, --resume
// only to recover a dead process. With no config/profile it degrades to empty
// output (same graceful fallback as before).

import { spawn } from "node:child_process";
import { loadConfig, buildRunParams, loadActiveProfile } from "@digital-threads/aimux/core";
import { listSubscriptions } from "../plugins/aimux/adapter.js";
import { createLiveSessionLauncher, type ProcLike, type SpawnSession } from "./live-session.js";
import { detectSandbox, wrapCommand } from "../security/os-sandbox.js";
import { enforcedSettingsPath } from "./enforced-settings.js";
import { listMcp as listMcpServers, type McpServer } from "../connectors/mcp.js";

export interface AimuxLiveLauncherDeps {
  loadConfig?: typeof loadConfig;
  buildParams?: typeof buildRunParams;
  profile?: string;
  model?: string;
  /** EXPERIMENTAL: wrap the child in an OS sandbox (writes confined to the
   *  worktree/cwd) when a backend is available. Off by default. A function is
   *  resolved per spawn so a Settings toggle takes effect on the next run. */
  sandbox?: boolean | (() => boolean);
  /** Source of the user's MCP registry (default: the real ~/.loom/mcp.json).
   *  Injectable for tests. */
  listMcp?: () => McpServer[];
}

/** Build the `--mcp-config <json>` pair from the enabled MCP servers, so the
 *  agent session actually receives the servers the user registered. Disabled
 *  servers and an empty registry yield no flag (zero behaviour change). The
 *  JSON is one argv element — it can never be re-read as a flag. */
export function mcpConfigArgs(servers: McpServer[]): string[] {
  const enabled = servers.filter((s) => s.enabled);
  if (enabled.length === 0) return [];
  const mcpServers: Record<string, { command: string; args?: string[] }> = {};
  for (const s of enabled) mcpServers[s.id] = s.args && s.args.length ? { command: s.command, args: s.args } : { command: s.command };
  return ["--mcp-config", JSON.stringify({ mcpServers })];
}

// manual/gated: normal Claude permissions (approvals surfaced to the Loom UI).
// autopilot: bypassPermissions adds --dangerously-skip-permissions = FULL host
// access — the user is warned at task creation that autopilot means full access.
// (A git worktree is NOT an isolation boundary; real isolation is a deferred
// hardening — see .docs deferred-features plan.)
const STREAM_FLAGS = ["-p", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json"];
// Force token-pilot's hooks into every Loom session regardless of the profile's
// config dir — the platform makes the mandatory tools non-optional.
const ENFORCE_FLAGS = ["--settings", enforcedSettingsPath()];

/** A ProcLike that yields one empty result then closes — used when there is no
 *  aimux config/profile, so the pipeline degrades gracefully instead of hanging. */
function emptyProc(): ProcLike {
  let onData: ((d: string) => void) | undefined;
  let onClose: (() => void) | undefined;
  return {
    stdin: {
      write: () => {
        queueMicrotask(() => {
          onData?.(JSON.stringify({ type: "result", subtype: "success", result: "" }) + "\n");
        });
      },
      end: () => queueMicrotask(() => onClose?.()),
    },
    stdout: { on: (_e, cb) => { onData = cb as (d: string) => void; } },
    on: (e, cb) => { if (e === "close") onClose = cb as () => void; },
    kill: () => {},
  };
}

export function createAimuxLiveLauncher(deps: AimuxLiveLauncherDeps = {}) {
  const load = deps.loadConfig ?? loadConfig;
  const build = deps.buildParams ?? buildRunParams;
  const listMcp = deps.listMcp ?? listMcpServers;
  const spawnSession: SpawnSession = ({ sessionId, resume, cwd, env: spineEnv, bypassPermissions, allowedTools, profile: runProfile }) => {
    const cfg = load();
    // Which subscription runs this session: the task's current profile (per-run,
    // set at creation / changed by a mid-session switch) → explicit dep → the
    // user's active profile (Accounts → Set active) → first subscription.
    const profile = runProfile ?? deps.profile ?? loadActiveProfile() ?? listSubscriptions()[0]?.name;
    if (!cfg || !profile) return emptyProc();
    const sessionArgs = resume ? ["--resume", sessionId] : ["--session-id", sessionId];
    // autopilot → full access (user-warned); manual/gated → safe allowlist, the
    // rest is denied and surfaced for approval in the UI.
    // --allowedTools=<csv> as ONE arg so a value can never be read as a flag
    // (defence against argv smuggling); endpoint also validates each tool's shape.
    const permArgs = bypassPermissions
      ? ["--dangerously-skip-permissions"]
      : allowedTools && allowedTools.length
        ? [`--allowedTools=${allowedTools.join(",")}`]
        : [];
    // The user's enabled MCP servers, passed additively after the enforced
    // token-pilot --settings (independent flag — injection is not affected).
    const mcpArgs = mcpConfigArgs(listMcp());
    const built = build(cfg, profile, { model: deps.model, extraArgs: [...STREAM_FLAGS, ...ENFORCE_FLAGS, ...mcpArgs, ...permArgs, ...sessionArgs] });
    // EXPERIMENTAL OS sandbox: confine writes to the worktree (cwd) when enabled.
    const sandboxOn = typeof deps.sandbox === "function" ? deps.sandbox() : !!deps.sandbox;
    const wrapped = sandboxOn && cwd ? wrapCommand(detectSandbox(), built.cli, built.args, cwd) : built;
    // spine env (LOOM_TASK_ID …) so token-pilot / task-journal inside the session
    // attribute their telemetry to this task — exact cost without a separate counter.
    const child = spawn(wrapped.cli, wrapped.args, { cwd, env: { ...process.env, ...built.env, ...spineEnv }, stdio: ["pipe", "pipe", "pipe"] });
    return child as unknown as ProcLike;
  };
  return createLiveSessionLauncher({ spawn: spawnSession });
}
