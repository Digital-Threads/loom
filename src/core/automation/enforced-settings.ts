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
import type { CmdRunner } from "../install/types.js";
import { resolveProbeCmd } from "../install/recipe.js";
import { defaultRun } from "../install/runner.js";
import { DEFAULT_DENY } from "../layers/security/policy.js";

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

// Command-policy PreToolUse(Bash) hook: enforce the security command policy on
// the AGENT's shell. The agent's Bash runs inside Claude (not Loom's executor),
// so the ONLY place to gate it is a PreToolUse hook. A baked floor (DEFAULT_DENY
// — rm -rf /, force-push, pipe-to-shell, …) always applies, even in autopilot;
// the user's extra allow/deny patterns are read fresh from ~/.loom/command-policy.json
// each call so edits in Security take effect without a restart. CommonJS (.cjs)
// so `require` works for the file read. (This is the enforcement seam that
// effectivePolicy()'s comment pointed at.)
const COMMAND_POLICY_SCRIPT = `const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const LOOM=process.env.XDG_DATA_HOME?path.join(process.env.XDG_DATA_HOME,"loom"):path.join(os.homedir(),".loom");
const FLOOR=${JSON.stringify(DEFAULT_DENY.map((re) => re.source))};
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
let cmd="";try{cmd=(JSON.parse(s).tool_input||{}).command||""}catch{}
if(!cmd)return process.exit(0);
let allow=[],deny=FLOOR.map(p=>new RegExp(p));
try{const cfg=JSON.parse(fs.readFileSync(path.join(LOOM,"command-policy.json"),"utf8"));
allow=(cfg.allow||[]).map(p=>{try{return new RegExp(p)}catch{return null}}).filter(Boolean);
deny=[...deny,...(cfg.deny||[]).map(p=>{try{return new RegExp(p)}catch{return null}}).filter(Boolean)];}catch{}
const block=r=>{process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:r}}));const tid=process.env.LOOM_TASK_ID;if(tid){try{const d=path.join(LOOM,"audit");fs.mkdirSync(d,{recursive:true});fs.appendFileSync(path.join(d,tid+".jsonl"),JSON.stringify({ts:Date.now(),taskId:tid,projectId:process.env.LOOM_PROJECT_ID||"",command:cmd,reason:r})+"\\n")}catch{}}process.exit(0)};
for(const re of deny){if(re.test(cmd))return block("Command blocked by the security policy (/"+re.source+"/). Change it in Security \\u2192 Command policy, or run a safer command.")}
if(allow.length&&!allow.some(re=>re.test(cmd)))return block("Command not in the security allow-list. Add an allow rule in Security \\u2192 Command policy if this is intended.");
process.exit(0)});`;

let cachedPath: string | null = null;
let warnedWriteFailure = false;

/** Write the deny-raw-search hook script once; returns its path. */
function denyRawSearchScriptPath(): string {
  const p = join(homedir(), ".loom", "hooks", "deny-raw-search.mjs");
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, DENY_RAW_SEARCH_SCRIPT, "utf8"); } catch { /* best-effort */ }
  return p;
}

/** Write the command-policy hook script once; returns its path. */
function commandPolicyScriptPath(): string {
  const p = join(homedir(), ".loom", "hooks", "command-policy.cjs");
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, COMMAND_POLICY_SCRIPT, "utf8"); } catch { /* best-effort */ }
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
  if (bash) {
    bash.hooks.push({ type: "command", command: `node ${denyRawSearchScriptPath()}` });
    bash.hooks.push({ type: "command", command: `node ${commandPolicyScriptPath()}` });
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
    cachedPath = path;
  } catch (err) {
    // Visible, NOT swallowed: a missing settings file means the session would
    // run WITHOUT token-pilot enforcement — that must never be silent. Don't
    // cache on failure, so a later call retries the write. Log only once, so a
    // persistently failing write (e.g. read-only HOME) on a per-call path like
    // enforceFlags() doesn't spam the log every stage.
    if (!warnedWriteFailure) {
      console.error(`[loom] failed to write enforced-settings to ${path}:`, err);
      warnedWriteFailure = true;
    }
  }
  return path;
}

/** The launch flags that force token-pilot's hooks into a session, regardless of
 *  the profile's config dir. Single source of truth for every launcher (live +
 *  headless stage agent) so the `--settings` path can never drift. */
export function enforceFlags(): string[] {
  return ["--settings", enforcedSettingsPath()];
}

/** Whether the enforced-settings write has failed (read-only HOME etc.). When
 *  true, the session runs WITHOUT token-pilot enforcement — already logged once,
 *  but a launcher reads this to also surface a visible per-task degraded marker. */
export function enforcedSettingsWriteFailed(): boolean {
  return warnedWriteFailure;
}

/** Whether `token-pilot` is on PATH — probed via the same which/where check the
 *  doctor uses. When false, a launched session degrades to raw reads, so the
 *  caller must surface a visible marker rather than fail silently. The run
 *  injection is for tests. */
export function tokenPilotOnPath(run: CmdRunner = defaultRun, platform: NodeJS.Platform = process.platform): boolean {
  return run(resolveProbeCmd("which", platform), ["token-pilot"]).ok;
}
