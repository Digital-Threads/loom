import { describe, it, expect } from "vitest";
import {
  runConcurrent,
  majorityVote,
  successes,
  type SwarmTask,
} from "../../../../src/core/layers/swarm/coordinator.js";

describe("runConcurrent", () => {
  it("runs all tasks and preserves order", async () => {
    const tasks: SwarmTask<number>[] = [1, 2, 3].map((n) => ({ id: `t${n}`, run: async () => n * 10 }));
    const res = await runConcurrent(tasks, 2);
    expect(res.map((r) => r.value)).toEqual([10, 20, 30]);
  });

  it("respects the concurrency cap (never more than N in flight)", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks: SwarmTask<void>[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      run: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
    }));
    await runConcurrent(tasks, 2);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("captures a throwing task as an error, never rejects", async () => {
    const tasks: SwarmTask<string>[] = [
      { id: "ok", run: async () => "fine" },
      { id: "bad", run: async () => { throw new Error("boom"); } },
    ];
    const res = await runConcurrent(tasks, 2);
    expect(res[0]).toEqual({ id: "ok", value: "fine" });
    expect(res[1]).toMatchObject({ id: "bad", error: "boom" });
  });
});

describe("majorityVote", () => {
  it("picks the most common value with count + ratio", () => {
    expect(majorityVote(["a", "b", "a", "a"])).toEqual({ winner: "a", count: 3, total: 4, ratio: 0.75 });
  });

  it("groups objects by JSON by default", () => {
    const c = majorityVote([{ x: 1 }, { x: 1 }, { x: 2 }]);
    expect(c.winner).toEqual({ x: 1 });
    expect(c.count).toBe(2);
  });

  it("empty → zero consensus", () => {
    expect(majorityVote([])).toEqual({ count: 0, total: 0, ratio: 0 });
  });
});

describe("successes", () => {
  it("drops error outcomes", () => {
    expect(successes([{ id: "a", value: 1 }, { id: "b", error: "x" }, { id: "c", value: 3 }])).toEqual([1, 3]);
  });
});
