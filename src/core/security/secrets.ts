// Secret scanning — flag likely credentials in text (e.g. an agent's output or
// a diff) before it is logged, shown, or committed. Findings REDACT the matched
// value: this module must never echo a full secret.

export interface SecretFinding {
  kind: string;
  /** Redacted preview, e.g. "sk-ant-…últimos4". Never the full secret. */
  preview: string;
  index: number;
}

interface Pattern {
  kind: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { kind: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai-key", re: /sk-[A-Za-z0-9]{20,}/g },
  { kind: "aws-access-key", re: /AKIA[0-9A-Z]{16}/g },
  { kind: "github-token", re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: "slack-token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    kind: "assigned-secret",
    re: /(?:password|secret|api[_-]?key|token)\s*[=:]\s*['"]?([A-Za-z0-9_\-]{12,})/gi,
  },
];

/** Redact a matched secret, keeping only a short head + tail for triage. */
function redact(value: string): string {
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/** Scan text for likely secrets. Returns redacted findings (never full values). */
export function scanSecrets(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ kind, preview: redact(m[0]), index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** True when the text contains at least one likely secret. */
export function hasSecret(text: string): boolean {
  return scanSecrets(text).length > 0;
}
