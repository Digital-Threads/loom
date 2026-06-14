import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import { getSteps, stepDeps } from "../../../src/core/store/steps.js";
import { planTask, parsePlan, planPrompt, type Decomposer } from "../../../src/core/automation/planner.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-plan-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Refund" });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("parsePlan", () => {
  it("parses a clean JSON array", () => {
    const specs = parsePlan('[{"id":"s1","title":"tests"},{"id":"s2","title":"impl","dependsOn":["s1"]}]');
    expect(specs).toEqual([
      { id: "s1", title: "tests", approach: undefined, files: undefined, dependsOn: undefined },
      { id: "s2", title: "impl", approach: undefined, files: undefined, dependsOn: ["s1"] },
    ]);
  });

  it("extracts the array from prose / code fences", () => {
    const text = 'Here is the plan:\n```json\n[{"id":"a","title":"A"}]\n```\nDone.';
    expect(parsePlan(text).map((s) => s.id)).toEqual(["a"]);
  });

  it("drops malformed entries and returns [] on no array", () => {
    expect(parsePlan('[{"id":"ok","title":"T"},{"title":"no id"},42]').map((s) => s.id)).toEqual(["ok"]);
    expect(parsePlan("not json at all")).toEqual([]);
  });

  it("keeps only string files/dependsOn", () => {
    const s = parsePlan('[{"id":"x","title":"X","files":["a.ts",3],"dependsOn":["y",null]}]')[0];
    expect(s.files).toEqual(["a.ts"]);
    expect(s.dependsOn).toEqual(["y"]);
  });
});

describe("planPrompt", () => {
  it("embeds the spec and asks for JSON only", () => {
    const p = planPrompt("Add refund");
    expect(p).toContain("Add refund");
    expect(p).toContain("JSON array");
  });
});

describe("planTask", () => {
  it("persists decomposed steps with deps to the store", async () => {
    const decomposer: Decomposer = {
      async decompose() {
        return [
          { id: "s1", title: "tests" },
          { id: "s2", title: "impl", approach: "redis key", files: ["refund.ts"], dependsOn: ["s1"] },
        ];
      },
    };
    const steps = await planTask(db, decomposer, "t1", "spec");
    expect(steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    const s2 = getSteps(db, "t1").find((s) => s.id === "s2")!;
    expect(s2.title).toBe("impl");
    expect(s2.approach).toBe("redis key");
    expect(stepDeps(s2)).toEqual(["s1"]);
  });
});
