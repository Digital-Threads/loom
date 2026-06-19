// Skills Loom ships in the package and installs into the user's ~/.claude/skills
// on first run, so the agent has Loom's review / PR / output skills out of the
// box (Loom is self-contained — it carries what its pipeline needs). A skill that
// already exists in the target is never overwritten.

import { readdirSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const BUNDLED_SKILLS = [
  "adversarial-review", // review stage — break the change before it ships
  "code-review-format", // review stage — consistent finding format
  "pr-description-format", // PR stage — the PR text Loom writes
  "natural-language-response", // human-readable output (matches the session rules)
];

/** The package's bundled skills directory (loom-host/skills, shipped via `files`).
 *  Resolves the same from src (tests) and dist (published): both are 3 levels
 *  under the package root. */
export function bundledSkillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../skills");
}

/** The user's global skills directory (where Claude Code reads skills). */
export function userSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

export interface SkillsInstallResult {
  installed: string[];
  skipped: string[];
}

/**
 * Copy each bundled skill into the target skills dir, skipping any that already
 * exist (never clobber a user's own skill of the same name). Defensive: a copy
 * failure on one skill doesn't stop the others. Idempotent — safe to re-run.
 */
export function installBundledSkills(
  target: string = userSkillsDir(),
  source: string = bundledSkillsDir(),
): SkillsInstallResult {
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const name of BUNDLED_SKILLS) {
    const dest = join(target, name);
    const src = join(source, name);
    if (existsSync(dest) || !existsSync(src)) {
      skipped.push(name);
      continue;
    }
    try {
      copyDir(src, dest);
      installed.push(name);
    } catch {
      skipped.push(name);
    }
  }
  return { installed, skipped };
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}
