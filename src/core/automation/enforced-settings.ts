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

// token-pilot's hooks deny oversized Read and `cat <code>`, but pass recursive
// `grep -r`/`-R`/`-rn` and broad `find -name` — which dump a lot into context.
// This companion PreToolUse(Bash) hook closes that gap: it DENIES an unbounded
// recursive search (unless it's bounded by | head / --max-count / -maxdepth) and
// points the agent at find_usages / Glob. No deps — runs under plain node.
const DENY_RAW_SEARCH_SCRIPT = `let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
let cmd="";try{cmd=(JSON.parse(s).tool_input||{}).command||""}catch{}
const recGrep=/(^|[\\s;&|])(grep|egrep|rg)\\s+[^|]*-[A-Za-z]*[rR]/.test(cmd);
const broadFind=/(^|[\\s;&|])find\\s+\\S+[^|]*-name\\b/.test(cmd)&&!/-maxdepth/.test(cmd);
const bounded=/\\|\\s*(head|tail|wc)\\b/.test(cmd)||/--max-count|(^|\\s)-m\\s*\\d/.test(cmd);
if((recGrep||broadFind)&&!bounded){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Безлимитный рекурсивный поиск вываливает много в контекст. Для символов кода используй mcp__token-pilot__find_usages(symbol); для файлов — Glob; либо ограничь: grep ... | head -50, find ... -maxdepth N."}}))}
process.exit(0)});`;

let cachedPath: string | null = null;

/** Write the deny-raw-search hook script once; returns its path. */
function denyRawSearchScriptPath(): string {
  const p = join(homedir(), ".loom", "hooks", "deny-raw-search.mjs");
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, DENY_RAW_SEARCH_SCRIPT, "utf8"); } catch { /* best-effort */ }
  return p;
}

/** Write the enforced-settings file once and return its path, to pass to the
 *  agent launcher as `--settings <path>`. Augments the base token-pilot hooks
 *  with the Loom deny-raw-search Bash hook. */
export function enforcedSettingsPath(): string {
  if (cachedPath) return cachedPath;
  const path = join(homedir(), ".loom", "enforced-settings.json");
  // Deep-clone the base settings + append our Bash hook, so ENFORCED_SETTINGS
  // (asserted by tests) stays the pure token-pilot config.
  const settings = JSON.parse(JSON.stringify(ENFORCED_SETTINGS)) as typeof ENFORCED_SETTINGS;
  const bash = settings.hooks.PreToolUse.find((h) => h.matcher === "Bash");
  if (bash) bash.hooks.push({ type: "command", command: `node ${denyRawSearchScriptPath()}` });
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
    cachedPath = path;
  } catch {
    cachedPath = path; // best-effort; a stale/partial file still beats none
  }
  return path;
}
