import { describe, it, expect } from "vitest";
import { recallPrior, parseRecall, partitionHits } from "../../../src/core/knowledge/recall.js";

const sample = JSON.stringify([
  { task_id: "tj-1", project_hash: "abc12345", event_type: "decision", text: "use Redis key", score: 2.5 },
  { task_id: "tj-2", project_hash: "abc12345", event_type: "rejection", text: "shared table", score: 1.2 },
]);

describe("parseRecall", () => {
  it("maps task-journal recall json into RecallHit[]", () => {
    expect(parseRecall(sample)).toEqual([
      { taskId: "tj-1", projectHash: "abc12345", eventType: "decision", text: "use Redis key", score: 2.5 },
      { taskId: "tj-2", projectHash: "abc12345", eventType: "rejection", text: "shared table", score: 1.2 },
    ]);
  });

  it("returns [] on empty array, non-array, or bad json", () => {
    expect(parseRecall("[]")).toEqual([]);
    expect(parseRecall("{}")).toEqual([]);
    expect(parseRecall("not json")).toEqual([]);
  });

  it("drops entries missing task_id or text", () => {
    const j = JSON.stringify([{ task_id: "ok", text: "t" }, { text: "no id" }, { task_id: "no text" }]);
    expect(parseRecall(j).map((h) => h.taskId)).toEqual(["ok"]);
  });
});

describe("recallPrior", () => {
  it("calls the runner with query/limit and parses output", () => {
    const calls: Array<[string, number]> = [];
    const hits = recallPrior("/proj", "refund idempotency", {
      limit: 3,
      run: (q, n) => {
        calls.push([q, n]);
        return sample;
      },
    });
    expect(calls).toEqual([["refund idempotency", 3]]);
    expect(hits.map((h) => h.taskId)).toEqual(["tj-1", "tj-2"]);
  });

  it("returns [] when the runner throws (binary missing / empty memory)", () => {
    const hits = recallPrior("/proj", "q", { run: () => { throw new Error("ENOENT"); } });
    expect(hits).toEqual([]);
  });
});

describe("partitionHits", () => {
  it("splits rejections from decisions", () => {
    const { rejections, decisions } = partitionHits(parseRecall(sample));
    expect(decisions.map((h) => h.taskId)).toEqual(["tj-1"]);
    expect(rejections.map((h) => h.taskId)).toEqual(["tj-2"]);
  });
});
