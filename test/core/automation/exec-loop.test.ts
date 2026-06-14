import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { createStep, getSteps } from "../../../src/core/store/steps.js";
import { listRunsForTask, getRun } from "../../../src/core/store/execute.js";
import {
  waves,
  runStep,
  runDag,
  busSink,
  type StepExecutor,
  type ExecResult,
} from "../../../src/core/automation/exec-loop.js";
import { loadLoomEvents } from "../../../src/core/spine/event-bus.js";
import type { LoomEvent } from "../../../src/core/spine/event.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-auto-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Refund" });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Executor that records calls and returns a scripted exit per step id. */
function mockExecutor(exits: Record<string, number> = {}): StepExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(req): Promise<ExecResult> {
      calls.push(req.step.id);
      const code = exits[req.step.id] ?? 0;
      return { exitCode: code, stdout: code === 0 ? "ok" : "", stderr: code === 0 ? "" : "boom" };
    },
  };
}

describe("waves (dependency layering)", () => {
  it("layers steps by depends_on", () => {
    createStep(db, { id: "s1", taskId: "t1", title: "tests" });
    createStep(db, { id: "s2", taskId: "t1", title: "endpoint", dependsOn: ["s1"] });
    createStep(db, { id: "s3", taskId: "t1", title: "webhook", dependsOn: ["s1"] });
    createStep(db, { id: "s4", taskId: "t1", title: "docs", dependsOn: ["s2"] });
    const layered = waves(getSteps(db, "t1")).map((w) => w.map((s) => s.id).sort());
    expect(layered).toEqual([["s1"], ["s2", "s3"], ["s4"]]);
  });

  it("stops at a cycle instead of looping forever", () => {
    createStep(db, { id: "a", taskId: "t1", title: "a", dependsOn: ["b"] });
    createStep(db, { id: "b", taskId: "t1", title: "b", dependsOn: ["a"] });
    expect(waves(getSteps(db, "t1"))).toEqual([]);
  });
});

describe("runStep", () => {
  it("records a run and marks the step done on exit 0", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "x", profile: "work" });
    const ex = mockExecutor();
    const res = await runStep(db, ex, "t1", getSteps(db, "t1")[0], { projectId: "p1", workflowId: "wf1" });
    expect(res.exitCode).toBe(0);
    expect(getSteps(db, "t1")[0].status).toBe("done");
    const run = getRun(db, "run-s1")!;
    expect(run).toMatchObject({ status: "done", exit_code: 0, workflow_id: "wf1", profile: "work" });
  });

  it("marks the step failed and run failed on non-zero exit", async () => {
    createStep(db, { id: "s2", taskId: "t1", title: "y" });
    await runStep(db, mockExecutor({ s2: 2 }), "t1", getSteps(db, "t1")[0], { projectId: "p1" });
    expect(getSteps(db, "t1")[0].status).toBe("failed");
    expect(getRun(db, "run-s2")!.status).toBe("failed");
  });

  it("turns an executor throw into a failed run (never throws)", async () => {
    createStep(db, { id: "s3", taskId: "t1", title: "z" });
    const thrower: StepExecutor = { async run() { throw new Error("nope"); } };
    const res = await runStep(db, thrower, "t1", getSteps(db, "t1")[0], { projectId: "p1" });
    expect(res.exitCode).toBe(1);
    expect(getSteps(db, "t1")[0].status).toBe("failed");
  });
});

describe("runDag", () => {
  it("runs every step in dependency order and reports ok", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "tests" });
    createStep(db, { id: "s2", taskId: "t1", title: "impl", dependsOn: ["s1"] });
    const ex = mockExecutor();
    const result = await runDag(db, ex, "t1", { projectId: "p1" });
    expect(result).toEqual({ ran: 2, failed: 0, ok: true });
    expect(ex.calls).toEqual(["s1", "s2"]);
    expect(listRunsForTask(db, "t1").map((r) => r.status)).toEqual(["done", "done"]);
  });

  it("does not run dependents after a wave fails", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "tests" });
    createStep(db, { id: "s2", taskId: "t1", title: "impl", dependsOn: ["s1"] });
    const ex = mockExecutor({ s1: 1 });
    const result = await runDag(db, ex, "t1", { projectId: "p1" });
    expect(result.failed).toBe(1);
    expect(result.ok).toBe(false);
    expect(ex.calls).toEqual(["s1"]); // s2 never launched
  });
});

describe("exec-loop event emission (F0.3)", () => {
  it("emits run/step lifecycle events in order with spine ids", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "tests" });
    createStep(db, { id: "s2", taskId: "t1", title: "impl", dependsOn: ["s1"] });
    const events: LoomEvent[] = [];
    await runDag(db, mockExecutor(), "t1", { projectId: "p1", workflowId: "wf1", taskId: "tj-1" }, undefined, (e) =>
      events.push(e),
    );
    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      "step.started",
      "step.completed",
      "step.started",
      "step.completed",
      "run.completed",
    ]);
    for (const e of events) {
      expect(e).toMatchObject({ schema: "loom.event.v1", source: "loom", projectId: "p1", workflowId: "wf1", taskId: "tj-1" });
    }
  });

  it("step.completed carries exitCode metric; run.completed carries ran/failed", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "x" });
    const events: LoomEvent[] = [];
    await runDag(db, mockExecutor({ s1: 2 }), "t1", { projectId: "p1" }, undefined, (e) => events.push(e));
    const stepDone = events.find((e) => e.type === "step.completed")!;
    expect(stepDone.metrics?.exitCode).toBe(2);
    expect(stepDone.severity).toBe("error");
    const runDone = events.find((e) => e.type === "run.completed")!;
    expect(runDone.metrics).toMatchObject({ ran: 1, failed: 1 });
    expect(runDone.severity).toBe("error");
  });

  it("default emit is a no-op (no throw without a sink)", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "x" });
    const result = await runDag(db, mockExecutor(), "t1", { projectId: "p1" });
    expect(result.ok).toBe(true);
  });
});

describe("busSink → event bus (F0.3)", () => {
  let prevXdg: string | undefined;
  let busDir: string;
  beforeEach(() => {
    prevXdg = process.env.XDG_DATA_HOME;
    busDir = mkdtempSync(join(tmpdir(), "loom-bus-"));
    process.env.XDG_DATA_HOME = busDir;
  });
  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(busDir, { recursive: true, force: true });
  });

  it("appends emitted events to the project's bus log", async () => {
    createStep(db, { id: "s1", taskId: "t1", title: "x" });
    await runDag(db, mockExecutor(), "t1", { projectId: "pbus", workflowId: "wf9" }, undefined, busSink("pbus"));
    const types = loadLoomEvents("pbus").map((e) => e.type);
    expect(types).toEqual(["run.started", "step.started", "step.completed", "run.completed"]);
  });
});
