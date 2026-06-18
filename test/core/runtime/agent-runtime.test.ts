import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask } from "../../../src/core/store/db.js";
import { createApi } from "../../../src/web/api.js";
import type { AgentRuntime } from "../../../src/core/runtime/agent-runtime.js";
import type Database from "better-sqlite3";

// Proves the pipeline/API talk to the engine ONLY through AgentRuntime: a fake
// runtime is injected and every Claude-flavoured surface (launcher, skills,
// connectors) is served from it — no real `claude`, ~/.claude or aimux touched.

let dir: string;
let db: Database.Database;

/** A self-contained fake engine recording what the API asked of it. */
function fakeRuntime() {
  const calls = { run: 0, listSkills: 0, listMcp: 0, importDrafts: 0 };
  const runtime: AgentRuntime = {
    id: "fake",
    launcher: {
      run: async () => {
        calls.run += 1;
        return { text: "answer from the fake runtime" };
      },
      costOf: () => 0,
      denialsOf: () => [],
      interject: () => false,
      stop: () => {},
    },
    skills: {
      list: () => {
        calls.listSkills += 1;
        return [{ name: "demo", description: "d", userInvocable: true, file: "/x/demo/SKILL.md", kind: "dir" }];
      },
      read: () => "demo body",
      write: () => true,
      delete: () => true,
      generate: async () => ({ name: "demo", content: "x" }),
    },
    connectors: {
      listMcp: () => {
        calls.listMcp += 1;
        return [{ id: "srv", command: "run-srv", enabled: true }];
      },
      importDrafts: () => {
        calls.importDrafts += 1;
        return [{ title: "Imported via runtime" }];
      },
    },
  };
  return { runtime, calls };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-runtime-"));
  db = openStore(join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("AgentRuntime seam", () => {
  it("GET /api/skills is served from runtime.skills", async () => {
    const { runtime, calls } = fakeRuntime();
    const app = createApi(db, { runtime });
    const res = await app.request("/api/skills");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skills: [{ name: "demo", description: "d", userInvocable: true, file: "/x/demo/SKILL.md", kind: "dir" }] });
    expect(calls.listSkills).toBe(1);
  });

  it("GET /api/connectors/mcp is served from runtime.connectors", async () => {
    const { runtime, calls } = fakeRuntime();
    const app = createApi(db, { runtime });
    const res = await app.request("/api/connectors/mcp");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servers: [{ id: "srv", command: "run-srv", enabled: true }] });
    expect(calls.listMcp).toBe(1);
  });

  it("POST /api/connectors/import pulls drafts from runtime.connectors", async () => {
    const { runtime, calls } = fakeRuntime();
    const app = createApi(db, { runtime });
    const res = await app.request("/api/connectors/import", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 1 });
    expect(calls.importDrafts).toBe(1);
  });

  it("a dialog stage runs through runtime.launcher", async () => {
    createTask(db, { id: "rt1", title: "Runtime task" });
    const { runtime, calls } = fakeRuntime();
    const app = createApi(db, { runtime });
    const res = await app.request("/api/tasks/rt1/brainstorm/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "build X" }),
    });
    expect(res.status).toBe(200);
    expect(calls.run).toBeGreaterThan(0); // the engine's launcher did the turn
    expect(getTask(db, "rt1")).toBeTruthy();
  });
});
