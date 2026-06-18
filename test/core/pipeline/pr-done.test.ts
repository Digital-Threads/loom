import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask, getStages } from "../../../src/core/store/db.js";
import { createArtifact } from "../../../src/core/store/artifacts.js";
import { runPr, runDone, prCompareUrl } from "../../../src/core/pipeline/pr-done.js";
import { loadLoomEvents } from "../../../src/core/spine/event-bus.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-pr-"));
  process.env.XDG_DATA_HOME = dir;
  db = openStore(join(dir, "s.db"));
  createTask(db, { id: "t1", title: "Refund", description: "add refund", branch: "loom/t1" });
});
afterEach(() => { db.close(); delete process.env.XDG_DATA_HOME; rmSync(dir, { recursive: true, force: true }); });

describe("runPr (L14.1)", () => {
  it("builds a description artifact from task + spec (no connector → not created)", async () => {
    createArtifact(db, { id: "sp", taskId: "t1", stage: "spec", kind: "spec-md", content: "# SDD body", status: "accepted" });
    const r = await runPr(db, "t1");
    expect(r.created).toBe(false);
    expect(r.description).toContain("# Refund");
    expect(r.description).toContain("# SDD body");
  });

  it("pushes the branch and returns a host PR-compare link (no gh, no auto-create)", async () => {
    const calls: string[][] = [];
    const sh = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (cmd === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:acme/widgets.git\n" };
      if (cmd === "git" && args[0] === "symbolic-ref") return { code: 0, stdout: "origin/master\n" };
      return { code: 0, stdout: "" };
    };
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo", describe: () => "BODY" });
    expect(r.pushed).toBe(true);
    expect(r.created).toBe(false); // we never auto-create — the user opens the PR
    expect(calls.some((c) => c[0] === "git" && c[1] === "push" && c.includes("loom/t1"))).toBe(true);
    expect(calls.some((c) => c[0] === "gh")).toBe(false); // host-agnostic — no gh
    expect(r.compareUrl).toBe("https://github.com/acme/widgets/compare/master...loom/t1?expand=1");
  });

  it("reports a clear error when the repo has no origin remote", async () => {
    const sh = async (cmd: string, args: string[]) => ({ code: cmd === "git" && args[0] === "remote" ? 1 : 0, stdout: "" });
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo" });
    expect(r.pushed).toBe(false);
    expect(r.error).toMatch(/origin/i);
  });

  it("reports a clear error when the push fails", async () => {
    const sh = async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:acme/widgets.git\n" };
      if (cmd === "git" && args[0] === "push") return { code: 1, stdout: "rejected: non-fast-forward" };
      return { code: 0, stdout: "" };
    };
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo" });
    expect(r.pushed).toBe(false);
    expect(r.error).toMatch(/push/i);
  });
});

describe("prCompareUrl — host-agnostic 'open a PR/MR' link", () => {
  const cases: [string, string][] = [
    ["git@github.com:acme/widgets.git", "https://github.com/acme/widgets/compare/master...feat?expand=1"],
    ["https://github.com/acme/widgets.git", "https://github.com/acme/widgets/compare/master...feat?expand=1"],
    ["git@gitlab.com:acme/group/widgets.git", "https://gitlab.com/acme/group/widgets/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat&merge_request%5Btarget_branch%5D=master"],
    ["git@bitbucket.org:acme/widgets.git", "https://bitbucket.org/acme/widgets/pull-requests/new?source=feat&dest=master"],
  ];
  for (const [remote, expected] of cases) {
    it(`maps ${remote}`, () => {
      expect(prCompareUrl(remote, "master", "feat")).toBe(expected);
    });
  }
  it("returns null for an unknown host (the UI then asks the user to open it manually)", () => {
    expect(prCompareUrl("git@example.com:acme/widgets.git", "master", "feat")).toBeNull();
  });
});

describe("runDone (L14.2)", () => {
  it("closes the task, marks done, emits task.done", () => {
    let closed = false;
    runDone(db, "t1", { projectId: "p1", closeTask: () => { closed = true; } });
    expect(closed).toBe(true);
    expect(getTask(db, "t1")?.status).toBe("done");
    expect(loadLoomEvents("p1").some((e) => e.type === "task.done")).toBe(true);
  });

  it("marks the pr and done stages done so the task screen isn't left mid-pipeline", () => {
    runDone(db, "t1", { projectId: "p1" });
    const stages = Object.fromEntries(getStages(db, "t1").map((s) => [s.stage_key, s.status]));
    expect(stages.pr).toBe("done");
    expect(stages.done).toBe("done");
  });
});
