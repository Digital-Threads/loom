import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CmdResult, CmdRunner } from "./types.js";

// PATH-aware, long-running command runner for the onboarding auto-installer.
// Unlike runner.defaultRun (5s timeout, used for fast PATH probes), this one:
//  - allows minutes-long installs (cargo build, npm -g) via a large timeout,
//  - runs a shell pipe when the step is `sh -c "..."` (rustup's curl | sh),
//  - prepends the freshly-installed tool dirs to the child's PATH so a tool we
//    just installed is visible to the very next step in the same run:
//    ~/.cargo/bin (rustup) and npm's global bin (where `npm i -g claude` lands,
//    which is not always already on PATH — nvm/custom prefix).
// Defensive: any failure -> { ok:false }, never throws (mirrors defaultRun).

// Best-effort npm global bin dir (`npm prefix -g` + /bin). Undefined if npm is
// absent or errors — we just skip it then.
function npmGlobalBin(): string | undefined {
  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], { encoding: "utf8", timeout: 5000 }).trim();
    return prefix ? join(prefix, "bin") : undefined;
  } catch {
    return undefined;
  }
}

export function makeShellRunner(opts: { timeoutMs?: number } = {}): CmdRunner {
  const timeout = opts.timeoutMs ?? 10 * 60_000;
  // Resolved lazily on first command (so building the runner has no side effect,
  // e.g. when it is only the unused default and tests inject their own runner).
  let extraDirs: string[] | undefined;
  const resolveExtra = (): string[] => {
    if (!extraDirs) {
      const npmBin = npmGlobalBin();
      extraDirs = npmBin ? [join(homedir(), ".cargo", "bin"), npmBin] : [join(homedir(), ".cargo", "bin")];
    }
    return extraDirs;
  };
  return (cmd, args): CmdResult => {
    const basePath = process.env.PATH ?? "";
    const have = new Set(basePath.split(":").filter(Boolean));
    const prepend = resolveExtra().filter((d) => !have.has(d));
    // filter(Boolean) also drops a trailing colon when basePath is empty
    // (a trailing colon would add CWD to the executable search path).
    const PATH = [...prepend, basePath].filter(Boolean).join(":");
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
