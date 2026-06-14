// Command policy — allow/deny guard for commands an agent may run. Pure: the
// caller decides what to do with a denial. Conservative defaults block the
// classic foot-guns; projects can extend allow/deny.

export interface CommandPolicy {
  /** If non-empty, a command must match at least one allow pattern. */
  allow?: RegExp[];
  /** A command matching any deny pattern is always blocked (deny wins). */
  deny?: RegExp[];
}

/** Patterns that are dangerous regardless of project. Deny always wins. */
export const DEFAULT_DENY: RegExp[] = [
  /\brm\s+-rf\s+[/~]/, // rm -rf / or ~
  /\bgit\s+push\s+.*--force/, // force-push
  /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh)\b/, // pipe-to-shell
  /\bchmod\s+-R\s+777\b/,
  /:\s*\(\)\s*\{.*\}\s*;/, // fork bomb shape
  /\bdd\s+if=.*of=\/dev\/(sd|nvme|disk)/, // raw disk write
];

export interface CommandVerdict {
  allowed: boolean;
  reason?: string;
}

/** Evaluate a command against the policy. Deny patterns are checked first and
 *  always win; then, if an allow-list is set, the command must match one. */
export function checkCommand(cmd: string, policy: CommandPolicy = {}): CommandVerdict {
  const deny = [...DEFAULT_DENY, ...(policy.deny ?? [])];
  for (const re of deny) {
    if (re.test(cmd)) return { allowed: false, reason: `blocked by deny pattern ${re}` };
  }
  if (policy.allow && policy.allow.length > 0) {
    const ok = policy.allow.some((re) => re.test(cmd));
    if (!ok) return { allowed: false, reason: "not in allow-list" };
  }
  return { allowed: true };
}
