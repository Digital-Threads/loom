import { describe, it, expect } from "vitest";
import { createRunManager, retryingExecutor } from "../../../src/core/automation/run-manager.js";
import { makeEvent } from "../../../src/core/spine/event.js";
import type { StepExecutor, ExecResult } from "../../../src/core/automation/exec-loop.js";

describe("run-manager (L4.3)", () => {
  it("returns a runId immediately and settles to done with result + events", async () => {
    const rm = createRunManager();
    const runId = rm.start({ projectId: "p1", toBus: false }, async (ctx) => {
      ctx.emit(makeEvent({ ts: 1, source: "loom", projectId: "p1", type: "run.started" }));
      ctx.appendOutput("hello");
      return { ran: 1 };
    });
    expect(runId).toMatch(/^run_[0-9a-f]{16}$/);
    expect(rm.get(runId)!.status).toBe("running");
    const rec = await rm.wait(runId);
    expect(rec.status).toBe("done");
    expect(rec.result).toEqual({ ran: 1 });
    expect(rec.events.map((e) => e.type)).toEqual(["run.started"]);
    expect(rec.output).toEqual(["hello"]);
  });

  it("captures failure as status failed + error", async () => {
    const rm = createRunManager();
    const runId = rm.start({ projectId: "p1", toBus: false }, async () => {
      throw new Error("boom");
    });
    const rec = await rm.wait(runId);
    expect(rec.status).toBe("failed");
    expect(rec.error).toBe("boom");
  });

  it("tracks child runs by parentRunId (swarm fan-out)", async () => {
    const rm = createRunManager();
    const parent = rm.start({ projectId: "p1", toBus: false }, async () => 0);
    const child1 = rm.start({ projectId: "p1", parentRunId: parent, toBus: false }, async () => 1);
    const child2 = rm.start({ projectId: "p1", parentRunId: parent, toBus: false }, async () => 2);
    await Promise.all([rm.wait(parent), rm.wait(child1), rm.wait(child2)]);
    expect(rm.childrenOf(parent).map((r) => r.runId).sort()).toEqual([child1, child2].sort());
  });
});

describe("retryingExecutor (L4.8)", () => {
  function flaky(failTimes: number): StepExecutor & { attempts: number } {
    let attempts = 0;
    return {
      get attempts() { return attempts; },
      async run(): Promise<ExecResult> {
        attempts += 1;
        return attempts <= failTimes ? { exitCode: 1, stderr: "fail" } : { exitCode: 0, stdout: "ok" };
      },
    } as StepExecutor & { attempts: number };
  }

  it("retries a failing step up to maxRetries, then succeeds", async () => {
    const ex = flaky(2);
    const wrapped = retryingExecutor(ex, { maxRetries: 3 });
    const res = await wrapped.run({ taskId: "t", step: { id: "s" } as never, ids: { projectId: "p" } });
    expect(res.exitCode).toBe(0);
    expect(ex.attempts).toBe(3); // 2 fails + 1 success
  });

  it("stays failed when retries are exhausted", async () => {
    const ex = flaky(5);
    const res = await retryingExecutor(ex, { maxRetries: 2 }).run({ taskId: "t", step: { id: "s" } as never, ids: { projectId: "p" } });
    expect(res.exitCode).toBe(1);
    expect(ex.attempts).toBe(3); // initial + 2 retries
  });
});
