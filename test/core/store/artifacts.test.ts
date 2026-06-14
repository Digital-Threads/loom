import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../../src/core/store/db.js";
import {
  createArtifact,
  getArtifacts,
  latestArtifact,
  setArtifactStatus,
  getArtifact,
  appendChatMessage,
  getChatMessages,
} from "../../../src/core/store/artifacts.js";
import type Database from "better-sqlite3";

let dir: string;
let db: Database.Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-art-"));
  db = openStore(join(dir, "s.db"));
  createTask(db, { id: "t1", title: "x" });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe("artifacts store (L12.0)", () => {
  it("auto-increments version per (task, kind)", () => {
    const a = createArtifact(db, { id: "a1", taskId: "t1", stage: "spec", kind: "spec-md", content: "v1" });
    const b = createArtifact(db, { id: "a2", taskId: "t1", stage: "spec", kind: "spec-md", content: "v2" });
    expect(a.version).toBe(1);
    expect(b.version).toBe(2);
    expect(latestArtifact(db, "t1", "spec-md")?.content).toBe("v2");
  });

  it("lists artifacts and tracks status transitions", () => {
    createArtifact(db, { id: "a1", taskId: "t1", stage: "brainstorm", kind: "brainstorm-summary", content: "s" });
    expect(getArtifacts(db, "t1")).toHaveLength(1);
    setArtifactStatus(db, "a1", "accepted");
    expect(getArtifact(db, "a1")?.status).toBe("accepted");
  });

  it("chat messages append and read back in order per stage", () => {
    appendChatMessage(db, { id: "m1", taskId: "t1", stage: "brainstorm", role: "agent", content: "q1?" });
    appendChatMessage(db, { id: "m2", taskId: "t1", stage: "brainstorm", role: "user", content: "a1" });
    appendChatMessage(db, { id: "m3", taskId: "t1", stage: "spec", role: "agent", content: "other stage" });
    const bs = getChatMessages(db, "t1", "brainstorm");
    expect(bs.map((m) => m.content)).toEqual(["q1?", "a1"]);
    expect(getChatMessages(db, "t1", "spec").map((m) => m.role)).toEqual(["agent"]);
  });
});
