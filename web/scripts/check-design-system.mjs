#!/usr/bin/env node
/* Design-system guard. Fails the build if the web UI bypasses the Loom Design
 * System: every colour/font must come from the tokens in web/src/tokens/ (used
 * as var(--…)), never hardcoded. Run on build and in CI.
 *
 * Allowed literals: the DS-sanctioned finding/diff text colours and #fff text on
 * accent/danger fills. Everything else hardcoded is a violation. The tokens/
 * directory IS the system, so it is exempt. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;
const TOKENS = join(ROOT, "tokens");

// Hex literals the design system itself defines (finding/diff readable variants)
// and white-on-colour text. Keep this list tiny and explicit.
const ALLOWED_HEX = new Set(["#fff", "#ffffff", "#ff8a80", "#6fe3a0"]);

// Old-palette fingerprints — must never reappear.
const BANNED = [
  /#5b9bff/i, /#7c5cff/i, /#0e1116/i, /#151a22/i, /#1b212b/i, /#262e3a/i,
  /rgba\(\s*124\s*,\s*92\s*,\s*255/, /rgba\(\s*91\s*,\s*155\s*,\s*255/,
  /rgba\(\s*63\s*,\s*185\s*,\s*80/, /rgba\(\s*210\s*,\s*153\s*,\s*34/,
  /rgba\(\s*248\s*,\s*81\s*,\s*73/,
];

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.startsWith(TOKENS)) continue; // the tokens dir IS the system
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    const ext = extname(p);
    if (![".css", ".tsx", ".ts"].includes(ext)) continue;
    if (p.endsWith(".test.tsx") || p.endsWith(".test.ts")) continue;
    lint(p, ext);
  }
}

function lint(file, ext) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${file.replace(ROOT, "src")}:${i + 1}`;
    for (const re of BANNED) {
      if (re.test(line)) violations.push(`${at}  old-palette literal — use a token: ${line.trim().slice(0, 80)}`);
    }
    // Hardcoded hex colours (allow the DS-sanctioned set).
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
      if (!ALLOWED_HEX.has(m[0].toLowerCase())) {
        violations.push(`${at}  hardcoded hex ${m[0]} — use a var(--…) token`);
      }
    }
    // Components (.tsx) must not carry inline colours at all.
    if (ext === ".tsx" && /(?:color|background)\s*:\s*["']?(?:#|rgb)/.test(line)) {
      violations.push(`${at}  inline colour in a component — style via a class + tokens`);
    }
    // Fonts must come from the tokens.
    if (/font-family\s*:/.test(line) && !/var\(--(?:font|sans|mono|display)/.test(line)) {
      violations.push(`${at}  hardcoded font-family — use var(--font-…)`);
    }
    // Components must not inline a hardcoded font size; use a var(--fs-…) token
    // (e.g. fontSize: "var(--fs-xs)"). Spacing is left to existing house style.
    if (ext === ".tsx" && /fontSize\s*:\s*-?\d/.test(line)) {
      violations.push(`${at}  inline hardcoded fontSize — use var(--fs-…)`);
    }
  });
}

walk(ROOT);

if (violations.length) {
  console.error(`\n✗ Design-system guard: ${violations.length} violation(s).\n`);
  for (const v of violations) console.error("  " + v);
  console.error("\nEvery colour/font must use a token from web/src/tokens/ (the Loom Design System).\n");
  process.exit(1);
}
console.log("✓ Design-system guard: all colours/fonts use the design-system tokens.");
