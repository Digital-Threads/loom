import { describe, it, expect } from "vitest";
import { renderDossier, diffSummary } from "../../../src/core/dashboard/dossier.js";

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

  it("appends a Changes section when a diff summary is supplied", () => {
    const md = renderDossier({
      pack: "history",
      stages: [],
      costs: [],
      attachments: [],
      diff: " src/a.ts | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)",
    });
    expect(md).toContain("## Changes");
    expect(md).toContain("1 file changed");
  });

  it("omits Changes when the diff is empty or whitespace", () => {
    expect(renderDossier({ pack: "h", stages: [], costs: [], attachments: [], diff: "" })).not.toContain("## Changes");
    expect(renderDossier({ pack: "h", stages: [], costs: [], attachments: [], diff: "   " })).not.toContain("## Changes");
  });

  it("returns just the pack when there is nothing to append", () => {
    expect(renderDossier({ pack: "only history", stages: [], costs: [], attachments: [] })).toBe("only history");
  });
});

describe("diffSummary (L3 dossier — Changes)", () => {
  const okSh = (stdout: string) => async () => ({ code: 0, stdout });

  it("returns the trimmed git diff --stat for base...branch", async () => {
    const calls: string[][] = [];
    const sh = async (cmd: string, args: string[], cwd?: string) => {
      calls.push([cmd, ...args, cwd ?? ""]);
      return { code: 0, stdout: "\n 1 file changed, 2 insertions(+)\n" };
    };
    const out = await diffSummary(sh, "/repo", "main", "loom/t1");
    expect(out).toBe("1 file changed, 2 insertions(+)");
    expect(calls[0]).toEqual(["git", "diff", "--stat", "main...loom/t1", "/repo"]);
  });

  it("returns empty string when git fails (no branch yet)", async () => {
    const sh = async () => ({ code: 128, stdout: "fatal: bad revision" });
    expect(await diffSummary(sh, "/repo", "main", "loom/x")).toBe("");
  });

  it("returns empty string for a clean working tree (no diff output)", async () => {
    expect(await diffSummary(okSh("\n"), "/repo", "main", "loom/y")).toBe("");
  });
});
