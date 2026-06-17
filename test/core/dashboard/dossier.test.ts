import { describe, it, expect } from "vitest";
import { renderDossier } from "../../../src/core/dashboard/dossier.js";

// L3 — the task History dossier weaves the journal reasoning-chain together with
// the pipeline's own record (stages, cost, artifacts) so one screen tells the
// whole story. renderDossier is pure: the endpoint feeds it the journal pack +
// db rows; the modal renders the Markdown unchanged.
describe("renderDossier (L3 task dossier)", () => {
  it("appends Stages, Cost and Artifacts sections to the journal pack", () => {
    const md = renderDossier({
      pack: "# Task\n\nGoal: do X.",
      stages: [
        { task_id: "t1", stage_key: "impl", status: "done", gate: 0, started_at: 1000, finished_at: 2000 },
        { task_id: "t1", stage_key: "review", status: "running", gate: 0, started_at: 3000, finished_at: null },
      ],
      costs: [
        { task_id: "t1", source: "claude", metric: "tokens", value: 1500, exact: 1, updated_at: 0 },
        { task_id: "t1", source: "token-pilot", metric: "tokens", value: 500, exact: 1, updated_at: 0 },
        { task_id: "t1", source: "claude", metric: "usd", value: 2, exact: 0, updated_at: 0 },
      ],
      attachments: [
        { id: "a1", task_id: "t1", kind: "file", name: "spec.md", path_or_url: "/repo/spec.md", created_at: 0 },
      ],
    });
    expect(md).toContain("Goal: do X."); // keeps the journal pack verbatim
    expect(md).toContain("## Stages");
    expect(md).toContain("impl");
    expect(md).toContain("review");
    expect(md).toContain("## Cost");
    expect(md).toContain("2000"); // tokens summed across sources (1500 + 500)
    expect(md).toContain("## Artifacts");
    expect(md).toContain("spec.md");
  });

  it("marks an estimated cost metric and omits empty sections", () => {
    const md = renderDossier({
      pack: "history",
      stages: [],
      costs: [{ task_id: "t1", source: "claude", metric: "usd", value: 3, exact: 0, updated_at: 0 }],
      attachments: [],
    });
    expect(md).toContain("## Cost");
    expect(md).toContain("est."); // exact=0 → flagged as an estimate
    expect(md).not.toContain("## Stages"); // empty → omitted
    expect(md).not.toContain("## Artifacts");
  });

  it("returns just the pack when there is nothing to append", () => {
    expect(renderDossier({ pack: "only history", stages: [], costs: [], attachments: [] })).toBe("only history");
  });
});
