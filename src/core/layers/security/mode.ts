// Security mode — how policy verdicts are enforced. `soft` (default) warns +
// audits but lets work proceed; `enforce` blocks (required before autopilot).
import { checkCommand, type CommandPolicy } from "./policy.js";

export type SecurityMode = "soft" | "enforce";

export interface EvalOptions {
  policy?: CommandPolicy;
  mode?: SecurityMode;
  /** When set, parent-dir traversal (`../`) is treated as a sandbox escape. */
  sandboxRoot?: string;
}

export interface CommandEvaluation {
  /** May the command run? (soft always lets it; enforce blocks bad commands.) */
  ok: boolean;
  blocked: boolean;
  warned: boolean;
  reason?: string;
}

/** Heuristic path-jail: parent-dir traversal escapes the sandbox worktree. */
export function pathEscapesJail(cmd: string): boolean {
  return /(^|\s|=|["'(])\.\.\//.test(cmd);
}

/** Evaluate a command against policy + path-jail under the active mode. */
export function evaluateCommand(cmd: string, opts: EvalOptions = {}): CommandEvaluation {
  const verdict = checkCommand(cmd, opts.policy);
  let reason = verdict.reason;
  let bad = !verdict.allowed;
  if (!bad && opts.sandboxRoot && pathEscapesJail(cmd)) {
    bad = true;
    reason = "path escapes sandbox";
  }
  if (!bad) return { ok: true, blocked: false, warned: false };
  if ((opts.mode ?? "soft") === "enforce") {
    return { ok: false, blocked: true, warned: false, reason };
  }
  return { ok: true, blocked: false, warned: true, reason };
}
