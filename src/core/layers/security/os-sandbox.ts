// OS-level sandbox (defense-in-depth, EXPERIMENTAL, opt-in). Wraps the agent
// child process so it can only WRITE inside the task worktree, while still
// reading the system (node, ~/.claude, the profile) and reaching the network
// (the model API). Off by default — a worktree alone is not isolation, and the
// exact bind set is environment-specific, so this is a tunable starting point.
//
// Backends: bubblewrap (Linux), sandbox-exec (macOS). None → passthrough.

import { execFileSync } from "node:child_process";

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

/** Wrap a command so writes are confined to `worktree`. Read-only host + network
 *  stay available (the model API needs the net). `none` returns the command
 *  unchanged. */
export function wrapCommand(backend: OsSandboxBackend, cli: string, args: string[], worktree: string): WrapResult {
  if (backend === "bubblewrap") {
    // read-only whole FS, writable worktree on top, /proc + /dev, network shared.
    const bwrap = [
      "--die-with-parent",
      "--share-net",
      "--proc", "/proc",
      "--dev", "/dev",
      "--ro-bind", "/", "/",
      "--bind", worktree, worktree,
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
      `(allow file-write* (subpath ${JSON.stringify(worktree)}))`,
    ].join(" ");
    return { cli: "sandbox-exec", args: ["-p", profile, cli, ...args] };
  }
  return { cli, args };
}
