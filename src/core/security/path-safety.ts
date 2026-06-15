// Path containment guard for serving task files to the UI. The file viewer must
// only ever read inside a task's own roots (its worktree / repo) — never escape
// via "../" or an absolute path elsewhere on disk.

import { isAbsolute, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

/** Resolve `rel` against `root` and return the absolute path ONLY if it stays
 *  inside `root`; otherwise null. Defeats "../" traversal and absolute escapes
 *  (purely lexical — the caller still stats/reads and so also catches symlinks
 *  that resolve outside, via realpath, if it chooses). */
export function safeResolve(root: string, rel: string): string | null {
  const base = resolve(root);
  const abs = isAbsolute(rel) ? resolve(rel) : resolve(base, rel);
  return abs === base || abs.startsWith(base + sep) ? abs : null;
}

/** First containment-safe resolution of `rel` across several allowed roots. */
export function safeResolveAny(roots: string[], rel: string): string | null {
  for (const r of roots) {
    if (!r) continue;
    const hit = safeResolve(r, rel);
    if (hit) return hit;
  }
  return null;
}

/** Resolve symlinks on `abs` and the roots, and verify the REAL path still sits
 *  inside one of the roots. This defeats a symlink planted in the repo that
 *  points outside it (the lexical safeResolve alone would miss that). Returns
 *  the real path if contained, else null. */
export function realContained(roots: string[], abs: string): string | null {
  let realAbs: string;
  try { realAbs = realpathSync(abs); } catch { return null; }
  for (const r of roots) {
    if (!r) continue;
    try {
      const realRoot = realpathSync(r);
      if (realAbs === realRoot || realAbs.startsWith(realRoot + sep)) return realAbs;
    } catch { /* root missing → skip */ }
  }
  return null;
}
