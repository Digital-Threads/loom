// L6.4 — default QA checks for the host: turn resolved flow keys (tests/build/…)
// into real commands run in the task's repo. Pure mapping + injected runner so
// it's testable without a shell. Keys with no backing script are reported as
// skipped (ok) rather than failing — QA fails only on a real failing command.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { QaCheck } from "../layers/quality/index.js";

/** Run a command in a directory; never throws — captures exit + combined output.
 *  ASYNC (execFile, not execFileSync): the QA stage runs the repo's full test
 *  suite + build, which can take minutes — a sync call would block the server's
 *  event loop and freeze every other request until it finished. */
export type ShRun = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; output: string }>;

const defaultSh: ShRun = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, output: stdout });
      const e = err as { code?: number };
      resolve({ code: typeof e.code === "number" ? e.code : 1, output: `${stdout ?? ""}${stderr ?? ""}` });
    });
  });

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
    // Always `run <script>` so we execute the package.json script. `bun test`
    // (and only bun) would otherwise launch Bun's OWN test runner instead of the
    // project's "test" script — e.g. a vitest project fails spuriously. `npm/
    // pnpm/yarn run test` are equivalent to their bare `test`, so this is safe.
    const args = ["run", name];
    return {
      key,
      run: async () => {
        const r = await sh(pm, args, env.repoRoot);
        return { ok: r.code === 0, output: clip(r.output) };
      },
    };
  };

  // The "tests" pass runs the package's `test` script AND, when present, `test:web`
  // — a separate browser/jsdom suite that the root `test` (e.g. vitest excluding
  // web/**) does NOT cover. Without this, UI-only changes pass QA unverified
  // (their component tests are never run). Fails if EITHER suite fails.
  const testsCheck = (): QaCheck => {
    const subs = [["host", "test"], ["web", "test:web"]].filter(([, name]) => scripts[name]) as Array<[string, string]>;
    if (!subs.length) return skipped("tests", `no "test" script in package.json`);
    return {
      key: "tests",
      run: async () => {
        const parts: string[] = [];
        let ok = true;
        for (const [label, name] of subs) {
          const r = await sh(pm, ["run", name], env.repoRoot);
          ok = ok && r.code === 0;
          parts.push(`[${label}] ${clip(r.output)}`);
        }
        return { ok, output: parts.join("\n\n") };
      },
    };
  };

  return keys.map((key) => {
    if (key === "tests") return testsCheck();
    if (key === "build") return script("build", "build");
    if (key === "browser") return skipped(key, "browser checks need a canary connector (not configured)");
    return skipped(key, "no default runner for this pass");
  });
}
