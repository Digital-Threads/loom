// Extensibility — integrity verification for installed plugins. A witness is a
// map of relative path → sha256 captured at install; verifyWitness recomputes
// and reports drift (tampered) or missing files, so Loom can refuse to load a
// plugin whose bytes changed under it.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type Witness = Record<string, string>; // relPath → sha256 hex

export function hashFile(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  try {
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
  } catch {
    return null;
  }
}

/** Capture a witness for the given relative paths under `dir`. Missing files
 *  are skipped (only present files are witnessed). */
export function computeWitness(dir: string, relPaths: string[]): Witness {
  const w: Witness = {};
  for (const rel of relPaths) {
    const h = hashFile(join(dir, rel));
    if (h) w[rel] = h;
  }
  return w;
}

export interface VerifyResult {
  ok: boolean;
  /** Files whose hash changed from the witness. */
  drifted: string[];
  /** Files in the witness that are now absent. */
  missing: string[];
}

/** Recompute hashes under `dir` and compare to the witness. */
export function verifyWitness(dir: string, witness: Witness): VerifyResult {
  const drifted: string[] = [];
  const missing: string[] = [];
  for (const [rel, expected] of Object.entries(witness)) {
    const actual = hashFile(join(dir, rel));
    if (actual === null) missing.push(rel);
    else if (actual !== expected) drifted.push(rel);
  }
  return { ok: drifted.length === 0 && missing.length === 0, drifted: drifted.sort(), missing: missing.sort() };
}
