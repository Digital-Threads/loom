// Path containment guard for serving task files to the UI. The file viewer must
// only ever read inside a task's own roots (its worktree / repo) — never escape
// via "../" or an absolute path elsewhere on disk.

import { isAbsolute, resolve, sep } from "node:path";

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
