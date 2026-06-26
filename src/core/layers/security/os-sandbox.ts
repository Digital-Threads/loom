// OS-level sandbox (defense-in-depth, EXPERIMENTAL, opt-in). Wraps the agent
// child process so it can only WRITE inside the task worktree, while still
// reading the system (node, ~/.claude, the profile) and reaching the network
// (the model API). Off by default — a worktree alone is not isolation, and the
// exact bind set is environment-specific, so this is a tunable starting point.
//
// Backends: bubblewrap (Linux), sandbox-exec (macOS). None → passthrough.

import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

export type OsSandboxBackend = "bubblewrap" | "sandbox-exec" | "none";

/** Detect an available sandbox backend. `has` is injected for tests. */
export function detectSandbox(
  platform: NodeJS.Platform = process.platform,
  has: (cmd: string) => boolean = defaultHas,
): OsSandboxBackend {
  if (platform === "linux" && has("bwrap")) return "bubblewrap";
  if (platform === "darwin" && has("sandbox-exec")) return "sandbox-exec";
  return "none";
}

function defaultHas(cmd: string): boolean {
  try {
    // `command -v` is portable; returns non-zero if absent.
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface WrapResult {
  cli: string;
  args: string[];
}

/** Wrap a command so writes are confined to `worktree` plus `extraWritable`
 *  (paths the agent legitimately needs to write: Claude's session-state dir for
 *  --resume, the aimux profile, a tmpdir). The rest of the FS is read-only; the
 *  network stays available (the model API + package installs need it). `none`
 *  returns the command unchanged.
 *
 *  The writable carve-outs matter: `--ro-bind / /` alone makes ~/.claude
 *  read-only, which breaks Claude Code's resumable sessions — so the caller passes
 *  those dirs in `extraWritable`. Paths are de-duped; empties dropped. */
export function wrapCommand(
  backend: OsSandboxBackend,
  cli: string,
  args: string[],
  worktree: string,
  extraWritable: string[] = [],
): WrapResult {
  const writable = [...new Set([worktree, ...extraWritable].filter(Boolean))];
  if (backend === "bubblewrap") {
    // ORDER MATTERS: --ro-bind / / FIRST (read-only whole FS), THEN overlay a real
    // /dev and /proc, THEN the writable carve-outs. If --ro-bind / / comes after
    // --dev/--proc it re-binds the host's read-only /dev over the special one, and
    // a Bun-based child (the claude CLI) segfaults (0xBBADBEEF) for want of a real
    // /dev. --dev-bind exposes the host devices the runtime needs; net shared.
    const binds = writable.flatMap((p) => ["--bind", p, p]);
    const bwrap = [
      "--die-with-parent",
      "--share-net",
      "--ro-bind", "/", "/",
      "--dev-bind", "/dev", "/dev",
      "--proc", "/proc",
      ...binds,
      "--",
      cli,
      ...args,
    ];
    return { cli: "bwrap", args: bwrap };
  }
  if (backend === "sandbox-exec") {
    const profile = [
      "(version 1)",
      "(allow default)",
      '(deny file-write* (subpath "/"))',
      // The agent (and the claude CLI / its Bun runtime) needs a writable temp
      // dir — e.g. /private/tmp/claude-<uid> and the per-user TMPDIR under
      // /private/var/folders. Without it EVERY command fails with "EPERM:
      // operation not permitted, mkdir" and the task stalls. Confinement is about
      // the user's repo/home, not temp (loom-sbtmp).
      '(allow file-write* (subpath "/private/tmp"))',
      '(allow file-write* (subpath "/private/var/folders"))',
      ...writable.map((p) => `(allow file-write* (subpath ${JSON.stringify(p)}))`),
    ].join(" ");
    return { cli: "sandbox-exec", args: ["-p", profile, cli, ...args] };
  }
  return { cli, args };
}

export interface ProbeResult { ok: boolean; out: string }

/** Probe runner: run `cli args` and capture combined output. Injected for tests. */
function defaultProbe(cli: string, args: string[]): ProbeResult {
  try {
    const out = execFileSync(cli, args, { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const usableCache = new Map<string, boolean>();

/** Can this backend actually RUN the agent CLI without the child crashing?
 *  A misconfigured bwrap segfaults the Bun-based `claude` (0xBBADBEEF) yet still
 *  exits 0, so a plain exit check is not enough — we verify the version probe
 *  prints a version and not a crash banner. Cached per (backend, cli). Lets the
 *  caller DEGRADE (run unconfined + a visible marker) instead of silently
 *  launching a sandbox that breaks the agent. `run` injected for tests. */
export function sandboxUsable(backend: OsSandboxBackend, cli: string, run: (c: string, a: string[]) => ProbeResult = defaultProbe): boolean {
  if (backend === "none") return false;
  const key = `${backend}:${cli}`;
  const hit = usableCache.get(key);
  if (hit !== undefined) return hit;
  const w = wrapCommand(backend, cli, ["--version"], tmpdir());
  const r = run(w.cli, w.args);
  // A Bun crash can exit 0, so check the OUTPUT: a real version string and no
  // crash banner.
  const ok = !/has crashed|panic\(|Segmentation/i.test(r.out) && /\d+\.\d+/.test(r.out);
  usableCache.set(key, ok);
  return ok;
}
