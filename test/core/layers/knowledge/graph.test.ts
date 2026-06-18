import { describe, it, expect } from "vitest";
import { buildGraph } from "../../../../src/core/layers/knowledge/graph.js";
import type { RecallHit } from "../../../../src/core/layers/knowledge/index.js";

const hit = (taskId: string, eventType: string, text: string): RecallHit => ({ taskId, eventType, text, projectHash: "h", score: 1 });

describe("buildGraph (L7.3)", () => {
  it("nodes per hit, edges chain hits of the same task", () => {
    const g = buildGraph([hit("t1", "decision", "chose axum"), hit("t1", "rejection", "ruled out X"), hit("t2", "decision", "y")]);
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0].kind).toBe("decision");
    expect(g.edges).toEqual([{ from: "n0", to: "n1" }]); // t1 chain; t2 alone
  });
  it("truncates long labels", () => {
    const g = buildGraph([hit("t", "decision", "x".repeat(100))]);
    expect(g.nodes[0].label.endsWith("…")).toBe(true);
  });
});
