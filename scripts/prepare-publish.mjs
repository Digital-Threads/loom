#!/usr/bin/env node
/* Release-time manifest swap (D2.1).
 *
 * Local development resolves the sibling layers through `file:../…` symlinks.
 * Those paths only exist on a developer's machine, so the PUBLISHED package must
 * instead depend on the layers by their registry versions.
 *
 * This script swaps every `file:..` dependency → its installed version in
 * `package.json` for the tarball (run from `prepack`), and restores the
 * byte-exact dev manifest afterwards (run from `postpack`, or manually with
 * `--restore`). The committed package.json therefore always keeps `file:..`,
 * and `bun install` during development is never touched (it does not run
 * prepack/postpack).
 *
 * IMPORTANT: the lifecycle hooks must actually fire, so publish with
 * `npm publish` (npm reliably runs prepack/postpack). */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(root, "package.json");
const BACKUP = join(root, "package.json.orig");

/**
 * Resolve the version a sibling dependency publishes under by reading the
 * version of the package actually installed in node_modules. This keeps the
 * published deps in lock-step with the linked layers — no hardcoded version
 * map to drift out of sync. Throws (loudly) if the layer is not installed.
 */
export function installedVersion(name, fromRoot = root) {
  const pkgPath = join(fromRoot, "node_modules", name, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(
      `prepare-publish: cannot resolve a version for "${name}" — it is not installed ` +
        `(${pkgPath}). Install the sibling layers before packing/publishing.`,
    );
  }
  const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  if (!version) throw new Error(`prepare-publish: "${name}" has no version in its package.json.`);
  return version;
}

/**
 * Pure transform: return a copy of the manifest where EVERY dependency that
 * points at a local path (`file:..`) is pinned to a resolved version. Operating
 * on the `file:` marker — not a fixed allowlist — means a newly added sibling is
 * handled automatically. As a safety net it throws if any `file:` dependency
 * survives the swap, so a broken manifest can never be published silently.
 */
export function swapToVersions(manifest, resolveVersion = installedVersion) {
  const next = structuredClone(manifest);
  const deps = next.dependencies ?? {};
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === "string" && spec.startsWith("file:")) {
      // Pin as a caret range (^x.y.z), not an exact version: an exact pin
      // conflicts in a flat global node_modules when the user already has the
      // sibling (e.g. aimux) installed standalone at a compatible version. The
      // range lets a satisfying existing install be reused instead of fighting it.
      // Only caret-prefix a real version — if the resolver misbehaves and returns
      // a path, leave it raw so the leftover guard below still trips.
      const v = resolveVersion(name);
      deps[name] = /^\d/.test(v) ? `^${v}` : v;
    }
  }
  const leftover = Object.entries(deps)
    .filter(([, v]) => typeof v === "string" && v.startsWith("file:"))
    .map(([n]) => n);
  if (leftover.length) {
    throw new Error(`prepare-publish: dependencies still point at a local path: ${leftover.join(", ")}`);
  }
  return next;
}

function prepack() {
  // Refuse to overwrite an existing backup: it means a previous pack/publish was
  // interrupted before postpack restored the manifest. Overwriting it would lose
  // the original file:.. specs. Run `--restore` first.
  if (existsSync(BACKUP)) {
    throw new Error(
      `prepare-publish: ${BACKUP} already exists — a previous pack did not restore the manifest. ` +
        `Run "node scripts/prepare-publish.mjs --restore" first.`,
    );
  }
  const raw = readFileSync(MANIFEST, "utf8");
  writeFileSync(BACKUP, raw); // byte-exact dev manifest, used by --restore
  const swapped = swapToVersions(JSON.parse(raw));
  writeFileSync(MANIFEST, JSON.stringify(swapped, null, 2) + "\n");
  // Diagnostics on stderr so `npm pack --json` stdout stays clean.
  console.error("prepare-publish: pinned sibling deps to installed versions for the tarball.");
}

function restore() {
  if (!existsSync(BACKUP)) {
    console.error("prepare-publish: nothing to restore (no backup).");
    return;
  }
  writeFileSync(MANIFEST, readFileSync(BACKUP, "utf8")); // byte-exact restore
  rmSync(BACKUP);
  console.error("prepare-publish: restored the development manifest (file:..).");
}

// Dispatch on the explicit flag, not on a path comparison: robust to symlinks
// and Windows path differences. When imported by tests neither flag is present,
// so nothing runs.
if (process.argv.includes("--prepack")) prepack();
else if (process.argv.includes("--restore")) restore();
