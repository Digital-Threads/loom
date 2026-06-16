// Hard enforcement of the platform's mandatory tools for every Loom-launched
// agent session. A Loom session runs under an aimux profile's CLAUDE_CONFIG_DIR
// that does NOT carry token-pilot's hooks, so the agent could fall back to raw
// Read/Grep/cat. We pass these settings via `--settings` on launch: Claude Code
// merges hooks as a UNION, so token-pilot's PreToolUse hooks fire on top of
// whatever the profile has — redirecting raw reads to the cheaper tools and
// reinforcing the rules every turn. token-pilot must be on PATH (it is, as a
// global bin); the command mirrors token-pilot's own installer (`token-pilot
// <action>`).

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const cmd = (action: string) => ({ type: "command" as const, command: `token-pilot ${action}` });

/** token-pilot's hook config (the enforcement subset of its installer) — forces
 *  the cheaper tools and re-injects the rules per turn. Additive: older Claude
 *  Code versions ignore unknown matchers/events. */
export const ENFORCED_SETTINGS = {
  hooks: {
    PreToolUse: [
      { matcher: "Read", hooks: [cmd("hook-read")] },
      { matcher: "Edit", hooks: [cmd("hook-edit")] },
      { matcher: "MultiEdit", hooks: [cmd("hook-edit")] },
      { matcher: "Bash", hooks: [cmd("hook-pre-bash")] },
      { matcher: "Grep", hooks: [cmd("hook-pre-grep")] },
      { matcher: "Task", hooks: [cmd("hook-pre-task")] },
    ],
    SessionStart: [{ hooks: [cmd("hook-session-start")] }],
    UserPromptSubmit: [{ hooks: [cmd("hook-user-prompt")] }],
  },
};

let cachedPath: string | null = null;

/** Write the enforced-settings file once and return its path, to pass to the
 *  agent launcher as `--settings <path>`. */
export function enforcedSettingsPath(): string {
  if (cachedPath) return cachedPath;
  const path = join(homedir(), ".loom", "enforced-settings.json");
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(ENFORCED_SETTINGS, null, 2), "utf8");
    cachedPath = path;
  } catch {
    cachedPath = path; // best-effort; a stale/partial file still beats none
  }
  return path;
}
