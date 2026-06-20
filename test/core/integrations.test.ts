import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getStages } from "../../src/core/store/db.js";
import { getSteps } from "../../src/core/store/steps.js";
import { getCosts } from "../../src/core/store/execute.js";
import { runSpec } from "../../src/core/automation/orchestrate.js";
import { computePriors } from "../../src/core/learning/priors.js";
import { spentForTask, recordSpend } from "../../src/core/observability/metrics.js";
import type { Decomposer } from "../../src/core/automation/planner.js";
import type { StepExecutor, ExecRequest } from "../../src/core/automation/exec-loop.js";
import type { RouteCandidate } from "../../src/core/automation/router.js";
import type { GitRunner } from "../../src/core/security/sandbox.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

const decomposer: Decomposer = {
  async decompose() {
    return [{ id: "s1", title: "do it" }];
  },
};
const okExec = (): StepExecutor => ({ async run() { return { exitCode: 0, stdout: "", stderr: "" }; } });
const candidates: RouteCandidate[] = [
  { profile: "work", model: "opus", costPerUnit: 4 }, // cheaper
  { profile: "personal", model: "sonnet", costPerUnit: 5 },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-int-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "T" });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("integration: learning priors → router (via runSpec)", () => {
  it("routes away from a cheap-but-unreliable profile when priors are supplied", async () => {
    const priors = computePriors([
      { profile: "work", success: false },
      { profile: "work", success: false }, // work rate 0 → cost ×2 → personal wins
    ]);
    await runSpec(db, { decomposer, executor: okExec() }, "t1", "spec", candidates, { projectId: "p1" }, { priors });
    expect(getSteps(db, "t1")[0].profile).toBe("personal");
  });

  it("without priors keeps the cheapest (work)", async () => {
    await runSpec(db, { decomposer, executor: okExec() }, "t1", "spec", candidates, { projectId: "p1" });
    expect(getSteps(db, "t1")[0].profile).toBe("work");
  });
});

describe("integration: security sandbox → exec (via runSpec)", () => {
  it("prepares a worktree and runs steps in its cwd", async () => {
    const gitCalls: string[][] = [];
    const git: GitRunner = (args) => {
      gitCalls.push(args);
      if (args[0] === "show-ref") throw new Error("ref not found"); // branch absent → create it
      return "";
    };
    let seenCwd: string | undefined;
    const executor: StepExecutor = {
      async run(req: ExecRequest) {
        seenCwd = req.cwd;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    const res = await runSpec(db, { decomposer, executor }, "t1", "spec", candidates, { projectId: "p1" }, {
      sandbox: { repoRoot: "/repo", base: "main", git },
    });

    expect(gitCalls.find((c) => c[0] === "worktree" && c[1] === "add")!.slice(0, 3)).toEqual(["worktree", "add", "-b"]);
    expect(res.cwd).toContain("worktrees");
    expect(seenCwd).toBe(res.cwd); // step ran in the worktree
    expect(res.exec.advanced).toBe(true);
    expect(getStages(db, "t1").find((s) => s.stage_key === "impl")!.status).toBe("done");
  });
});

describe("integration: observability spent (aimux usage)", () => {
  it("spentForTask sums only the task's sessions; recordSpend persists it", () => {
    const usage = [
      { sessionId: "s-a", total: 100 },
      { sessionId: "s-b", total: 250 },
      { sessionId: "s-other", total: 999 },
    ];
    const spent = spentForTask(usage, ["s-a", "s-b"]);
    expect(spent).toBe(350);

    recordSpend(db, "t1", spent, true);
    const cost = getCosts(db, "t1").find((c) => c.source === "aimux" && c.metric === "spent")!;
    expect(cost).toMatchObject({ value: 350, exact: 1 });
  });
});
