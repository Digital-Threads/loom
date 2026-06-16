import { describe, it, expect } from "vitest";
import { buildQaChecks, detectPackageManager } from "../../../src/core/quality/default-qa-checks.js";
import { runQa } from "@digital-threads/loom-quality";

describe("default QA checks", () => {
  it("runs the repo's test/build scripts via the detected package manager", async () => {
    const calls: Array<[string, string[]]> = [];
    const sh = async (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { code: 0, output: "ok" };
    };
    const checks = buildQaChecks(["tests", "build"], {
      repoRoot: "/repo",
      sh,
      pm: "pnpm",
      scripts: { test: "vitest", build: "tsc" },
    });
    const res = await runQa(checks);
    expect(res.passed).toBe(true);
    expect(calls).toEqual([
      ["pnpm", ["test"]],
      ["pnpm", ["run", "build"]],
    ]);
  });

  it("a failing command fails QA and keeps the output", async () => {
    const sh = async () => ({ code: 1, output: "1 test failed" });
    const checks = buildQaChecks(["tests"], { repoRoot: "/repo", sh, scripts: { test: "vitest" } });
    const res = await runQa(checks);
    expect(res.passed).toBe(false);
    expect(res.results[0].output).toContain("1 test failed");
  });

  it("skips (does not fail) a key with no backing script", async () => {
    const checks = buildQaChecks(["tests", "build", "browser", "custom:simplify"], {
      repoRoot: "/repo",
      sh: async () => ({ code: 99, output: "should not run" }),
      scripts: {},
    });
    const res = await runQa(checks);
    expect(res.passed).toBe(true);
    expect(res.results.every((r) => r.output?.startsWith("skipped:"))).toBe(true);
  });

  it("detects the package manager from the lockfile", () => {
    const ends = (suffix: string) => (p: string) => p.endsWith(suffix);
    expect(detectPackageManager("/r", ends("bun.lockb"))).toBe("bun");
    expect(detectPackageManager("/r", ends("pnpm-lock.yaml"))).toBe("pnpm");
    expect(detectPackageManager("/r", ends("yarn.lock"))).toBe("yarn");
    expect(detectPackageManager("/r", () => false)).toBe("npm");
  });
});
