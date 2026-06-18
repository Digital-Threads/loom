import { describe, it, expect } from "vitest";
import { recallPrior, parseRecall, partitionHits } from "../../../../src/core/layers/knowledge/index.js";

describe("@digital-threads/loom-knowledge (standalone)", () => {
  it("parses recall --json into hits", () => {
    const json = JSON.stringify([
      { task_id: "tj-1", project_hash: "h", event_type: "decision", text: "chose axum", score: 0.9 },
      { task_id: "tj-2", event_type: "rejection", text: "ruled out X", score: 0.5 },
      { bad: true },
    ]);
    const hits = parseRecall(json);
    expect(hits).toHaveLength(2);
    expect(hits[0].taskId).toBe("tj-1");
  });

  it("partitions decisions vs rejections", () => {
    const { decisions, rejections } = partitionHits(parseRecall(
      JSON.stringify([
        { task_id: "a", event_type: "decision", text: "d" },
        { task_id: "b", event_type: "rejection", text: "r" },
      ]),
    ));
    expect(decisions.map((h) => h.taskId)).toEqual(["a"]);
    expect(rejections.map((h) => h.taskId)).toEqual(["b"]);
  });

  it("recallPrior returns [] on runner failure (defensive)", () => {
    const hits = recallPrior("/x", "q", { run: () => { throw new Error("no binary"); } });
    expect(hits).toEqual([]);
  });

  it("recallPrior parses an injected runner's output", () => {
    const hits = recallPrior("/x", "axum", {
      run: () => JSON.stringify([{ task_id: "t", event_type: "decision", text: "ok" }]),
    });
    expect(hits[0].text).toBe("ok");
  });
});
