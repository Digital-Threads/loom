// Prod implementation of the injections: the real command executor + default deps.
import { execFileSync } from "node:child_process";
import { loomDataDir } from "../paths.js";
import type { CmdResult, CmdRunner, InstallDeps } from "./types.js";

// execFileSync wrapper. Defensive: any error -> {ok:false}, does NOT throw.
export const defaultRun: CmdRunner = (cmd, args): CmdResult => {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", timeout: 5000 });
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

export function defaultDeps(): InstallDeps {
  return { dataDir: loomDataDir(), run: defaultRun };
}
