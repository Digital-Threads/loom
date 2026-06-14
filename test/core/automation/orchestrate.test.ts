import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getStages } from "../../../src/core/store/db.js";
import { getSteps } from "../../../src/core/store/steps.js";
import { runSpec } from "../../../src/core/automation/orchestrate.js";
import type { Decomposer } from "../../../src/core/automation/planner.js";
import type { StepExecutor, ExecRequest } from "../../../src/core/automation/exec-loop.js";
import type { RouteCandidate } from "../../../src/core/automation/router.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

const decomposer: Decomposer = {
  async decompose() {
    return [
      { id: "s1", title: "tests" },
      { id: "s2", title: "impl", dependsOn: ["s1"] },
    ];
  },
};

const candidates: RouteCandidate[] = [
  { profile: "personal", model: "sonnet", costPerUnit: 4, quotaRemaining: 9 },
  { profile: "work", model: "opus", costPerUnit: 10, quotaRemaining: 9 },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-orch-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Refund" });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("runSpec — plan → route → execute", () => {
  it("plans, routes to cheapest profile, executes and advances impl", async () => {
    const ran: string[] = [];
    const executor: StepExecutor = {
      async run(req: ExecRequest) {
        ran.push(`${req.step.id}@${req.step.profile}`);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    };

    const result = await runSpec(db, { decomposer, executor }, "t1", "Add refund", candidates, {
      projectId: "p1",
      workflowId: "wf1",
    });

    expect(result.steps).toBe(2);
    expect(result.assigned).toBe(2);
    expect(result.unrouted).toEqual([]);
    expect(result.exec.advanced).toBe(true);

    // routed to the cheapest profile + executed in dep order
    expect(ran).toEqual(["s1@personal", "s2@personal"]);
    const steps = getSteps(db, "t1");
    expect(steps.every((s) => s.profile === "personal" && s.model === "sonnet")).toBe(true);
    expect(getStages(db, "t1").find((s) => s.stage_key === "impl")!.status).toBe("done");
  });

  it("reports unrouted steps when no candidate is eligible", async () => {
    const executor: StepExecutor = { async run() { return { exitCode: 0, stdout: "", stderr: "" }; } };
    const result = await runSpec(db, { decomposer, executor }, "t1", "spec", [], {
      projectId: "p1",
    });
    expect(result.assigned).toBe(0);
    expect(result.unrouted.sort()).toEqual(["s1", "s2"]);
  });

  it("does not advance impl when a step fails", async () => {
    const executor: StepExecutor = {
      async run(req) {
        return { exitCode: req.step.id === "s1" ? 1 : 0, stdout: "", stderr: "x" };
      },
    };
    const result = await runSpec(db, { decomposer, executor }, "t1", "spec", candidates, {
      projectId: "p1",
    });
    expect(result.exec.advanced).toBe(false);
    expect(getStages(db, "t1").find((s) => s.stage_key === "impl")!.status).toBe("active");
  });
});
