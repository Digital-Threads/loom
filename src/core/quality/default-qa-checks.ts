// L6.4 — default QA checks for the host: turn resolved flow keys (tests/build/…)
// into real commands run in the task's repo. Pure mapping + injected runner so
// it's testable without a shell. Keys with no backing script are reported as
// skipped (ok) rather than failing — QA fails only on a real failing command.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { QaCheck } from "@digital-threads/loom-quality";

/** Run a command in a directory; never throws — captures exit + combined output. */
export type ShRun = (cmd: string, args: string[], cwd: string) => { code: number; output: string };

const defaultSh: ShRun = (cmd, args, cwd) => {
  try {
    const output = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
};

function readScripts(repoRoot: string): Record<string, string> {
  const p = join(repoRoot, "package.json");
  if (!existsSync(p)) return {};
  try {
    return (JSON.parse(readFileSync(p, "utf8")).scripts as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

/** Detect the package manager from the repo's lockfile (default npm). */
export function detectPackageManager(
  repoRoot: string,
  exists: (p: string) => boolean = (p) => existsSync(p),
): "bun" | "pnpm" | "yarn" | "npm" {
  if (exists(join(repoRoot, "bun.lockb")) || exists(join(repoRoot, "bun.lock"))) return "bun";
  if (exists(join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(join(repoRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

const MAX_OUTPUT = 4000;
const clip = (s: string) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (truncated)` : s);

export interface QaCheckEnv {
  repoRoot: string;
  sh?: ShRun;
  scripts?: Record<string, string>;
  pm?: "bun" | "pnpm" | "yarn" | "npm";
}

/** Build runnable QA checks for the resolved flow keys. */
export function buildQaChecks(keys: string[], env: QaCheckEnv): QaCheck[] {
  const sh = env.sh ?? defaultSh;
  const scripts = env.scripts ?? readScripts(env.repoRoot);
  const pm = env.pm ?? detectPackageManager(env.repoRoot);
  const skipped = (key: string, why: string): QaCheck => ({
    key,
    run: async () => ({ ok: true, output: `skipped: ${why}` }),
  });
  const script = (key: string, name: string): QaCheck => {
    if (!scripts[name]) return skipped(key, `no "${name}" script in package.json`);
    const args = name === "test" ? ["test"] : ["run", name];
    return {
      key,
      run: async () => {
        const r = sh(pm, args, env.repoRoot);
        return { ok: r.code === 0, output: clip(r.output) };
      },
    };
  };

  return keys.map((key) => {
    if (key === "tests") return script("tests", "test");
    if (key === "build") return script("build", "build");
    if (key === "browser") return skipped(key, "browser checks need a canary connector (not configured)");
    return skipped(key, "no default runner for this pass");
  });
}
