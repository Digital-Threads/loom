import { describe, it, expect } from "vitest";
import { resolveRebaseWithAgent, type RebaseResolveDeps } from "../../../src/core/pipeline/rebase-resolve.js";

/** A scripted git runner: matches on the joined args, returns the mapped result,
 *  and records every call so the test can assert the sequence. Unmapped calls
 *  succeed with empty stdout (the common case for side-effecting commands). */
function gitMock(script: Record<string, { code?: number; stdout?: string }>) {
  const calls: string[][] = [];
  const git: RebaseResolveDeps["git"] = async (args) => {
    calls.push(args);
    const hit = script[args.join(" ")];
    return { code: hit?.code ?? 0, stdout: hit?.stdout ?? "" };
  };
  return { git, calls };
}

describe("resolveRebaseWithAgent", () => {
  it("re-enters the rebase, runs ONE agent pass, and confirms success when the tree is clean and the base is an ancestor", async () => {
    const { git, calls } = gitMock({
      "status --porcelain": { stdout: "" }, // clean
      "merge-base --is-ancestor origin/main HEAD": { code: 0 }, // rebase landed
    });
    const prompts: string[] = [];
    const agent: RebaseResolveDeps["agent"] = async (p) => { prompts.push(p); return "done"; };

    const r = await resolveRebaseWithAgent("/wt", "origin/main", { git, agent });

    expect(r.resolved).toBe(true);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("origin/main"); // the agent is told the base
    // the rebase was re-entered before the agent ran, and was NOT aborted on success
    expect(calls).toContainEqual(["rebase", "origin/main"]);
    expect(calls).not.toContainEqual(["rebase", "--abort"]);
  });

  it("aborts the rebase and reports failure when the agent leaves an unfinished/dirty rebase", async () => {
    const { git, calls } = gitMock({
      "status --porcelain": { stdout: "UU src/x.ts" }, // unmerged → not finished
      "merge-base --is-ancestor origin/main HEAD": { code: 1 },
    });
    const agent: RebaseResolveDeps["agent"] = async () => "gave up";

    const r = await resolveRebaseWithAgent("/wt", "origin/main", { git, agent });

    expect(r.resolved).toBe(false);
    expect(calls).toContainEqual(["rebase", "--abort"]); // left a clean tree for the human fallback
  });

  it("reports failure when the tree is clean but the base is NOT an ancestor (rebase didn't complete)", async () => {
    const { git, calls } = gitMock({
      "status --porcelain": { stdout: "" }, // clean…
      "merge-base --is-ancestor origin/main HEAD": { code: 1 }, // …but base not reached
    });
    const agent: RebaseResolveDeps["agent"] = async () => "aborted internally";

    const r = await resolveRebaseWithAgent("/wt", "origin/main", { git, agent });

    expect(r.resolved).toBe(false);
    expect(calls).toContainEqual(["rebase", "--abort"]);
  });
});
