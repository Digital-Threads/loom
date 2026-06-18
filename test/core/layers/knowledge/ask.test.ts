import { describe, it, expect } from "vitest";
import { askSearch } from "../../../../src/core/layers/knowledge/ask.js";

describe("askSearch (L7.2)", () => {
  it("parses ask --json output (injected runner)", () => {
    const hits = askSearch("/p", "axum", { run: () => JSON.stringify([{ task_id: "t", event_type: "decision", text: "use axum" }]) });
    expect(hits[0].text).toBe("use axum");
  });
  it("returns [] on failure", () => {
    expect(askSearch("/p", "q", { run: () => { throw new Error("no bin"); } })).toEqual([]);
  });
});
