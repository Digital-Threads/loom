import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask, getStages } from "../../../src/core/store/db.js";
import { createArtifact } from "../../../src/core/store/artifacts.js";
import { runPr, runDone } from "../../../src/core/pipeline/pr-done.js";
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

  it("pushes + creates a PR via gh when connector is on", async () => {
    const calls: string[][] = [];
    const sh = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      // gh pr create returns the PR url; preflight (gh --version, git remote) ok.
      return { code: 0, stdout: cmd === "gh" && args[0] === "pr" ? "https://github.com/x/y/pull/1\n" : "" };
    };
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo", base: "main", describe: () => "BODY" });
    expect(r.created).toBe(true);
    expect(r.url).toBe("https://github.com/x/y/pull/1");
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(true);
    expect(calls.some((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")).toBe(true);
  });

  it("targets the repo's default branch (origin/HEAD), not a hardcoded 'main', when no base is given", async () => {
    const calls: string[][] = [];
    const sh = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (cmd === "git" && args[0] === "symbolic-ref") return { code: 0, stdout: "origin/master\n" };
      return { code: 0, stdout: cmd === "gh" && args[0] === "pr" ? "https://github.com/x/y/pull/9\n" : "" };
    };
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo", describe: () => "BODY" });
    expect(r.created).toBe(true);
    const create = calls.find((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create");
    expect(create).toBeDefined();
    const baseIdx = create!.indexOf("--base");
    expect(create![baseIdx + 1]).toBe("master");
  });

  it("reports a clear error (not created) when gh is missing", async () => {
    const sh = async (cmd: string) => ({ code: cmd === "gh" ? 1 : 0, stdout: cmd === "gh" ? "gh: command not found" : "" });
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo" });
    expect(r.created).toBe(false);
    expect(r.connector).toBe(true);
    expect(r.error).toMatch(/gh/i);
  });

  it("reports a clear error when the repo has no origin remote", async () => {
    const sh = async (cmd: string, args: string[]) => ({ code: cmd === "git" && args[0] === "remote" ? 1 : 0, stdout: "" });
    const r = await runPr(db, "t1", { connector: true, sh, branch: "loom/t1", repoRoot: "/repo" });
    expect(r.created).toBe(false);
    expect(r.error).toMatch(/origin/i);
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
