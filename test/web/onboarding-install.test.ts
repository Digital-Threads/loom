import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../src/core/store/db.js";
import { createApi } from "../../src/web/api.js";
import type { CmdRunner } from "../../src/core/install/types.js";
import type Database from "better-sqlite3";

// A runner where nothing is present yet and every install command succeeds, so
// the SSE plan runs end to end deterministically (no real install side effects).
const allInstall: CmdRunner = (cmd, args) => {
  if (cmd === "which" || cmd === "where") return { ok: false, stdout: "", stderr: "" };
  if (args.includes("list")) return { ok: true, stdout: "", stderr: "" };
  return { ok: true, stdout: "", stderr: "" };
};

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-onb-"));
  db = openStore(join(dir, "test.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/onboarding/install/stream", () => {
  it("streams per-step progress and a final done event", async () => {
    const app = createApi(db, { installRunner: allInstall });
    const res = await app.request("/api/onboarding/install/stream");
    expect(res.status).toBe(200);
    const text = await res.text();
    // every unit reports progress, ending in a done summary
    expect(text).toContain("event: step");
    expect(text).toContain("event: done");
    for (const id of ["cargo", "claude", "token-pilot", "task-journal"]) {
      expect(text).toContain(`"id":"${id}"`);
    }
    expect(text).toContain('"state":"done"');
  });

  it("idempotent: already-present tools/plugins stream as skipped", async () => {
    const present: CmdRunner = (cmd, args) => {
      if (cmd === "which" || cmd === "where") return { ok: true, stdout: "", stderr: "" };
      if (args.includes("list")) return { ok: true, stdout: "token-pilot@token-pilot\ntask-journal@task-journal", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    };
    const app = createApi(db, { installRunner: present });
    const res = await app.request("/api/onboarding/install/stream");
    const text = await res.text();
    expect(text).toContain('"state":"skipped"');
    expect(text).toContain("already installed");
    expect(text).not.toContain('"state":"installing"');
  });
});
