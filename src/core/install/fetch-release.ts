// Install a tool from its GitHub Release prebuilt binaries instead of building
// from source (loom-hwfu). Cross-platform: curl downloads, Node verifies the
// sha256 (against the release's checksums.txt), tar extracts (bsdtar on Win10+
// handles .zip too), and the named binaries land on PATH. Synchronous to fit the
// recipe runner — onboarding is a setup step, blocking is fine (like cargo).

import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FetchReleaseSpec } from "../plugins/contract.js";

// The spec is part of the plugin contract; re-export so install code has one import.
export type { FetchReleaseSpec };

/** A command runner (curl/tar) — the same shape the recipe runner already uses. */
export type CmdRun = (cmd: string, args: string[]) => { ok: boolean; stdout: string; stderr: string };

/** Map the running platform+arch to the Rust target triple + archive extension
 *  used in the release asset names. null = unsupported (caller falls back). Pure. */
export function releaseTarget(
  platform: NodeJS.Platform,
  arch: string,
): { target: string; ext: "tar.gz" | "zip" } | null {
  if (platform === "linux" && arch === "x64") return { target: "x86_64-unknown-linux-gnu", ext: "tar.gz" };
  if (platform === "darwin" && arch === "arm64") return { target: "aarch64-apple-darwin", ext: "tar.gz" };
  if (platform === "darwin" && arch === "x64") return { target: "x86_64-apple-darwin", ext: "tar.gz" };
  if (platform === "win32" && arch === "x64") return { target: "x86_64-pc-windows-msvc", ext: "zip" };
  return null;
}

/** The asset file name: `<name>-<tag>-<target>.<ext>`. Pure. */
export function assetFileName(name: string, tag: string, target: string, ext: string): string {
  return `${name}-${tag}-${target}.${ext}`;
}

/** The download URL for a release asset. Pure. */
export function releaseAssetUrl(repo: string, tag: string, file: string): string {
  return `https://github.com/${repo}/releases/download/${tag}/${file}`;
}

/** Parse a `checksums.txt` (`<sha256>␠␠<filename>` per line) into filename→sha.
 *  Tolerates blank lines and a single-space separator. Pure. */
export function parseChecksums(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

/** Install `spec`'s binaries from its GitHub release into `dest`, verifying the
 *  sha256. `tmp` is a scratch dir for the downloads. Returns ok/error. */
export function fetchRelease(
  spec: FetchReleaseSpec,
  opts: { platform: NodeJS.Platform; arch: string; dest: string; tmp: string; run: CmdRun },
): { ok: boolean; error?: string } {
  const t = releaseTarget(opts.platform, opts.arch);
  if (!t) return { ok: false, error: `no prebuilt binary for ${opts.platform}/${opts.arch}` };

  const file = assetFileName(spec.name, spec.tag, t.target, t.ext);
  const archive = join(opts.tmp, file);
  const sums = join(opts.tmp, "checksums.txt");
  mkdirSync(opts.tmp, { recursive: true });

  const dl = opts.run("curl", ["-fsSL", releaseAssetUrl(spec.repo, spec.tag, file), "-o", archive]);
  if (!dl.ok) return { ok: false, error: `download failed: ${dl.stderr || file}` };
  const dlSums = opts.run("curl", ["-fsSL", releaseAssetUrl(spec.repo, spec.tag, "checksums.txt"), "-o", sums]);
  if (!dlSums.ok) return { ok: false, error: `checksums download failed: ${dlSums.stderr || "checksums.txt"}` };

  const expected = parseChecksums(readFileSync(sums, "utf8"))[file];
  if (!expected) return { ok: false, error: `no checksum listed for ${file}` };
  const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (actual !== expected) return { ok: false, error: `checksum mismatch for ${file}` };

  mkdirSync(opts.dest, { recursive: true });
  const ex = opts.run("tar", ["-xf", archive, "-C", opts.dest]); // bsdtar handles .tar.gz AND .zip
  if (!ex.ok) return { ok: false, error: `extract failed: ${ex.stderr || file}` };

  for (const bin of spec.bins) {
    const p = join(opts.dest, opts.platform === "win32" ? `${bin}.exe` : bin);
    if (!existsSync(p)) return { ok: false, error: `binary ${bin} missing after extract` };
    if (opts.platform !== "win32") { try { chmodSync(p, 0o755); } catch { /* best-effort */ } }
  }
  return { ok: true };
}
