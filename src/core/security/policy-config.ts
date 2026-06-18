// Host-side security configuration (loom-host only). The ../layers/security/index.js
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
 *  Kept in sync by hand: the package's PATTERNS list is not exported. If the
 *  loom-security package adds/renames a detector, update this list to match. */
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

/** Max RegExp source length we accept — a guard against pathological patterns. */
export const MAX_PATTERN_LEN = 200;
/** Cap on text length scanned by a custom rule, and matches kept per rule —
 *  bounds the work a user pattern can do against (large) agent output. */
export const MAX_SCAN_LEN = 1_000_000;
export const MAX_MATCHES_PER_RULE = 1000;

// Shapes prone to catastrophic backtracking (ReDoS). Custom rules run against
// arbitrary agent output on every turn, so reject the classic foot-guns rather
// than only checking that the source compiles.
const REDOS_SHAPES: RegExp[] = [
  /\([^)]*[+*]\)[+*]/, // nested quantifier: (a+)+ / (a*)* / (a+)*
  /\([^)]*\{\d+,?\d*\}\)[+*{]/, // (a{2,}){3,} style
  /[+*]\)?[+*]/, // adjacent unbounded quantifiers: a+* / a*+
];

/** Validate a user RegExp source without throwing. Also rejects over-long and
 *  obviously ReDoS-prone patterns, since these run on every agent turn. */
export function checkRegex(source: unknown): RegexCheck {
  if (typeof source !== "string" || source.trim() === "") return { ok: false, error: "empty pattern" };
  if (source.length > MAX_PATTERN_LEN) return { ok: false, error: `pattern too long (max ${MAX_PATTERN_LEN})` };
  for (const shape of REDOS_SHAPES) {
    if (shape.test(source)) return { ok: false, error: "pattern looks prone to catastrophic backtracking (ReDoS)" };
  }
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
      // Strip control characters and cap length so a crafted kind can't inject
      // newlines or noise into the audit trail it later appears in.
      // eslint-disable-next-line no-control-regex
      const kind = (r as SecretRule).kind.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 60);
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
  setSetting(db, KEY_ENABLED, enabled === true); // strict boolean: only `true` enables
  return { ok: true };
}

/** Build the effective command policy: DEFAULT_DENY always applies; valid user
 *  patterns are layered on. Invalid sources are dropped (already rejected on save).
 *  NOTE: enforcement (calling checkCommand with this policy) is not yet wired into
 *  the runtime — this is the seam a future change will use. */
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
 *  findings are redacted just like built-in ones. Input length and per-rule
 *  match count are bounded so a broad/expensive pattern can't stall the host. */
export function scanWithCustom(text: string, rules: SecretRule[]): SecretFinding[] {
  const out = scanSecrets(text);
  const slice = text.length > MAX_SCAN_LEN ? text.slice(0, MAX_SCAN_LEN) : text;
  for (const rule of rules) {
    const re = compileRegex(rule.source, "g");
    if (!re) continue;
    let m: RegExpExecArray | null;
    let hits = 0;
    while ((m = re.exec(slice)) !== null) {
      out.push({ kind: rule.kind, preview: redact(m[0]), index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      if (++hits >= MAX_MATCHES_PER_RULE) break; // bound array growth
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
