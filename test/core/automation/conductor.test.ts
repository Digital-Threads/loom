import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getStages, updateStageStatus } from "../../../src/core/store/db.js";
import { createStep } from "../../../src/core/store/steps.js";
import { executeImplStage } from "../../../src/core/automation/conductor.js";
import type { StepExecutor } from "../../../src/core/automation/exec-loop.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

const ok: StepExecutor = { async run() { return { exitCode: 0, stdout: "ok", stderr: "" }; } };
const fail: StepExecutor = { async run() { return { exitCode: 1, stdout: "", stderr: "boom" }; } };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-cond-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Refund" });
  createStep(db, { id: "s1", taskId: "t1", title: "tests" });
  createStep(db, { id: "s2", taskId: "t1", title: "impl", dependsOn: ["s1"] });
  updateStageStatus(db, "t1", "impl", "active"); // pretend we're at the impl stage
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("conductor executeImplStage", () => {
  it("runs the DAG and advances the impl stage on success", async () => {
    const res = await executeImplStage(db, ok, "t1", { projectId: "p1", workflowId: "wf1" });
    expect(res.dag).toEqual({ ran: 2, failed: 0, ok: true });
    expect(res.advanced).toBe(true);
    const impl = getStages(db, "t1").find((s) => s.stage_key === "impl")!;
    expect(impl.status).toBe("done");
  });

  it("leaves the impl stage active on failure", async () => {
    const res = await executeImplStage(db, fail, "t1", { projectId: "p1" });
    expect(res.advanced).toBe(false);
    expect(res.dag.failed).toBeGreaterThan(0);
    const impl = getStages(db, "t1").find((s) => s.stage_key === "impl")!;
    expect(impl.status).toBe("active");
  });
});
