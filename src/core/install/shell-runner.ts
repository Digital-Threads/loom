import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CmdResult, CmdRunner } from "./types.js";

// PATH-aware, long-running command runner for the onboarding auto-installer.
// Unlike runner.defaultRun (5s timeout, used for fast PATH probes), this one:
//  - allows minutes-long installs (cargo build, npm -g) via a large timeout,
//  - runs a shell pipe when the step is `sh -c "..."` (rustup's curl | sh),
//  - prepends ~/.cargo/bin to the child's PATH so a freshly-installed cargo is
//    visible to the very next probe in the same run (rustup drops it there).
// Defensive: any failure -> { ok:false }, never throws (mirrors defaultRun).
export function makeShellRunner(opts: { timeoutMs?: number } = {}): CmdRunner {
  const timeout = opts.timeoutMs ?? 10 * 60_000;
  const cargoBin = join(homedir(), ".cargo", "bin");
  return (cmd, args): CmdResult => {
    const basePath = process.env.PATH ?? "";
    const PATH = basePath.split(":").includes(cargoBin) ? basePath : `${cargoBin}:${basePath}`;
    try {
      const stdout = execFileSync(cmd, args, {
        encoding: "utf8",
        timeout,
        env: { ...process.env, PATH },
      });
      return { ok: true, stdout: stdout ?? "", stderr: "" };
    } catch (err) {
      const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
      return {
        ok: false,
        stdout: typeof e.stdout === "string" ? e.stdout : "",
        stderr: typeof e.stderr === "string" ? e.stderr : (e.message ?? String(err)),
      };
    }
  };
}
