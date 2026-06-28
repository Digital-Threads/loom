// Prod implementation of the injections: the real command executor + default deps.
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loomDataDir } from "../paths.js";
import { fetchRelease } from "./fetch-release.js";
import type { CmdResult, CmdRunner, InstallDeps } from "./types.js";

// execFileSync wrapper with a configurable timeout. Defensive: any error ->
// {ok:false}, does NOT throw.
function runWith(timeoutMs: number): CmdRunner {
  return (cmd, args): CmdResult => {
    try {
      const stdout = execFileSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
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

// Quick commands (probes, plugin installs) — short timeout.
export const defaultRun: CmdRunner = runWith(5000);
// Download/extract (curl/tar) — a multi-MB release would blow a 5s timeout.
const fetchRun: CmdRunner = runWith(120_000);

export function defaultDeps(): InstallDeps {
  return {
    dataDir: loomDataDir(),
    run: defaultRun,
    fetchRelease: (spec, ctx) => fetchRelease(spec, {
      platform: ctx.platform ?? process.platform,
      arch: process.arch,
      dest: join(homedir(), ".local", "bin"),
      tmp: join(tmpdir(), "loom-fetch-release"),
      run: fetchRun,
    }),
  };
}
