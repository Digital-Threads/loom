// Host-side security configuration (loom-host only). The @digital-threads/loom-security
// package is pure and stateless; the EDITABLE layer — extra allow/deny command
// patterns, custom secret-scan rules, and the secret-scan on/off switch — lives
// in the host settings store and is surfaced/edited via /api/security/*.
//
// Built-in defaults (DEFAULT_DENY, the package's secret patterns) are shown
// read-only. User patterns are stored as plain strings and compiled here, so a
// malformed pattern is reported, never thrown at runtime.
import type Database from "better-sqlite3";
import { DEFAULT_DENY, type CommandPolicy } from "./policy.js";
import { scanSecrets, type SecretFinding } from "./secrets.js";
import { getSetting, setSetting } from "../store/settings.js";

export interface SecretRule {
  kind: string;
  /** RegExp source string (compiled with the "g" flag when scanning). */
  source: string;
}

export interface SecurityConfig {
  /** Extra allow patterns (RegExp sources). If any allow exists, a command must match one. */
  allow: string[];
  /** Extra deny patterns (RegExp sources), layered on top of DEFAULT_DENY. */
  deny: string[];
  /** User-defined secret-scan rules, applied in addition to the built-in set. */
  secretRules: SecretRule[];
  /** Master switch for secret scanning on the host's scan paths. */
  secretScanEnabled: boolean;
}

export const KEY_ALLOW = "security.policy.allow";
export const KEY_DENY = "security.policy.deny";
export const KEY_RULES = "security.secrets.customRules";
export const KEY_ENABLED = "security.secretScan.enabled";

/** The secret kinds the package scanner covers (read-only mirror for display).
 *  Kept in sync by hand: the package's PATTERNS list is not exported. */
export const DEFAULT_SECRET_KINDS: string[] = [
  "anthropic-key",
  "openai-key",
  "aws-access-key",
  "github-token",
  "slack-token",
  "private-key",
  "assigned-secret",
];

/** RegExp sources of the always-on deny patterns (shown read-only). */
export function defaultDenySources(): string[] {
  return DEFAULT_DENY.map((re) => re.source);
}

export interface RegexCheck {
  ok: boolean;
  error?: string;
}

/** Validate a user RegExp source without throwing. */
export function checkRegex(source: unknown): RegexCheck {
  if (typeof source !== "string" || source.trim() === "") return { ok: false, error: "empty pattern" };
  try {
    new RegExp(source);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Compile a source to a RegExp, or null if it is invalid. Never throws. */
export function compileRegex(source: string, flags?: string): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function sanitizeStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((s): s is string => typeof s === "string" && s.trim() !== ""))];
}

function sanitizeRules(v: unknown): SecretRule[] {
  if (!Array.isArray(v)) return [];
  const out: SecretRule[] = [];
  for (const r of v) {
    if (r && typeof r === "object" && typeof (r as SecretRule).kind === "string" && typeof (r as SecretRule).source === "string") {
      const kind = (r as SecretRule).kind.trim();
      const source = (r as SecretRule).source;
      if (kind && source.trim()) out.push({ kind, source });
    }
  }
  return out;
}

/** Read the current security configuration from the settings store. */
export function loadSecurityConfig(db: Database.Database): SecurityConfig {
  return {
    allow: sanitizeStrings(getSetting<unknown>(db, KEY_ALLOW, [])),
    deny: sanitizeStrings(getSetting<unknown>(db, KEY_DENY, [])),
    secretRules: sanitizeRules(getSetting<unknown>(db, KEY_RULES, [])),
    secretScanEnabled: getSetting<boolean>(db, KEY_ENABLED, true) !== false,
  };
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/** Validate and persist the command policy (allow/deny). Rejects bad patterns. */
export function saveCommandPolicy(db: Database.Database, allow: unknown, deny: unknown): SaveResult {
  const a = sanitizeStrings(allow);
  const d = sanitizeStrings(deny);
  for (const s of [...a, ...d]) {
    const c = checkRegex(s);
    if (!c.ok) return { ok: false, error: `invalid pattern "${s}": ${c.error}` };
  }
  setSetting(db, KEY_ALLOW, a);
  setSetting(db, KEY_DENY, d);
  return { ok: true };
}

/** Validate and persist the secret-scan rules and the on/off switch. */
export function saveSecretConfig(db: Database.Database, rules: unknown, enabled: unknown): SaveResult {
  const r = sanitizeRules(rules);
  for (const rule of r) {
    const c = checkRegex(rule.source);
    if (!c.ok) return { ok: false, error: `invalid rule "${rule.kind}": ${c.error}` };
  }
  setSetting(db, KEY_RULES, r);
  setSetting(db, KEY_ENABLED, enabled !== false);
  return { ok: true };
}

/** Build the effective command policy: DEFAULT_DENY always applies; valid user
 *  patterns are layered on. Invalid sources are dropped (already rejected on save). */
export function effectivePolicy(cfg: SecurityConfig): CommandPolicy {
  const deny = [...DEFAULT_DENY, ...cfg.deny.map((s) => compileRegex(s)).filter((re): re is RegExp => re !== null)];
  const allow = cfg.allow.map((s) => compileRegex(s)).filter((re): re is RegExp => re !== null);
  return { deny, allow };
}

/** Redact a matched secret to a short head+tail; never echo the full value. */
function redact(value: string): string {
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** Scan text with the built-in patterns plus any custom rules. Custom-rule
 *  findings are redacted just like built-in ones. */
export function scanWithCustom(text: string, rules: SecretRule[]): SecretFinding[] {
  const out = scanSecrets(text);
  for (const rule of rules) {
    const re = compileRegex(rule.source, "g");
    if (!re) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ kind: rule.kind, preview: redact(m[0]), index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export interface PolicySummary {
  allowCount: number;
  denyCount: number;
  defaultDenyCount: number;
  secretRuleCount: number;
  defaultSecretKindCount: number;
  secretScanEnabled: boolean;
}

/** Counts for the Security panel's policy summary line. */
export function policySummary(cfg: SecurityConfig): PolicySummary {
  return {
    allowCount: cfg.allow.length,
    denyCount: cfg.deny.length,
    defaultDenyCount: DEFAULT_DENY.length,
    secretRuleCount: cfg.secretRules.length,
    defaultSecretKindCount: DEFAULT_SECRET_KINDS.length,
    secretScanEnabled: cfg.secretScanEnabled,
  };
}
