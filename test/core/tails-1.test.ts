import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { limitsForType } from "../../src/core/security/sandbox-backend.js";
import { openStore, createTask } from "../../src/core/store/db.js";
import { addAttachment, attachmentsPrompt } from "../../src/core/store/attachments.js";
import type Database from "better-sqlite3";

describe("limitsForType (D3.4)", () => {
  it("maps project type to a sandbox time budget", () => {
    expect(limitsForType("web").timeoutMs).toBe(15 * 60_000);
    expect(limitsForType("lib").timeoutMs).toBe(5 * 60_000);
    expect(limitsForType(undefined).timeoutMs).toBe(10 * 60_000);
  });
});

describe("attachmentsPrompt (D6.6)", () => {
  let dir: string;
  let db: Database.Database;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "loom-t1-")); db = openStore(join(dir, "s.db")); createTask(db, { id: "t1", title: "T" }); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it("renders attachment lines (empty when none)", () => {
    expect(attachmentsPrompt(db, "t1")).toBe("");
    addAttachment(db, { id: "a1", taskId: "t1", kind: "link", name: "spec", pathOrUrl: "https://x" });
    addAttachment(db, { id: "a2", taskId: "t1", kind: "file", name: "img.png", pathOrUrl: "/p/img.png" });
    const out = attachmentsPrompt(db, "t1");
    expect(out).toContain("link: spec (https://x)");
    expect(out).toContain("file: img.png (/p/img.png)");
  });
});
