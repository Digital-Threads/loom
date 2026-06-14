import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../src/core/store/db.js";
import { createStep } from "../../src/core/store/steps.js";
import { startTask } from "../../src/core/pipeline/engine.js";
import { createApi } from "../../src/web/api.js";
import type Database from "better-sqlite3";
import type { Hono } from "hono";

let dir: string;
let db: Database.Database;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-api-"));
  db = openStore(join(dir, "test.db"));
  createTask(db, { id: "t1", title: "Refund API" });
  createStep(db, { id: "s1", taskId: "t1", title: "tests" });
  startTask(db, "t1"); // analysis active (gated)
  app = createApi(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function json(path: string) {
  const res = await app.request(path);
  return { status: res.status, body: await res.json() };
}

describe("web api", () => {
  it("GET /api/health", async () => {
    expect(await json("/api/health")).toEqual({ status: 200, body: { ok: true } });
  });

  it("GET /api/workspace returns the injected 3-module workspace (F1.1)", async () => {
    const ws = {
      subscriptions: [{ profile: "work" }],
      sessions: [],
      health: [{ profile: "work", ok: true }],
      tokens: [{ sessionId: "s", used: 10, saved: 2 }],
      tokenEvents: [],
      taskEvents: [],
      tasks: [{ id: "tj-1", title: "x" }],
      errors: [],
      projectId: "p1",
    };
    const app2 = createApi(db, { loadWorkspace: async () => ws as never });
    const res = await app2.request("/api/workspace");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ws);
  });

  it("POST /api/accounts/health re-loads and returns health (F1.5)", async () => {
    const ws = { health: [{ profile: "work", ok: true }] };
    const app2 = createApi(db, { loadWorkspace: async () => ws as never });
    const res = await app2.request("/api/accounts/health", { method: "POST" });
    expect(await res.json()).toEqual({ health: [{ profile: "work", ok: true }] });
  });

  it("POST /api/accounts/active swaps the active profile (F1.5)", async () => {
    const swapped: string[] = [];
    const app2 = createApi(db, { setActiveProfile: (p) => swapped.push(p) });
    const res = await app2.request("/api/accounts/active", {
      method: "POST",
      body: JSON.stringify({ profileId: "main" }),
    });
    expect(await res.json()).toEqual({ active: "main" });
    expect(swapped).toEqual(["main"]);
  });

  it("POST /api/accounts/active requires profileId (F1.5)", async () => {
    const app2 = createApi(db, { setActiveProfile: () => {} });
    const res = await app2.request("/api/accounts/active", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
  });

  it("GET /api/memory/tasks/:id returns the injected detail (F1.5)", async () => {
    const app2 = createApi(db, { memoryTask: (id) => ({ id, decisions: ["d1"] }) });
    const res = await app2.request("/api/memory/tasks/tj-9");
    expect(await res.json()).toEqual({ detail: { id: "tj-9", decisions: ["d1"] } });
  });

  it("GET /api/board returns 9 columns with the task in analysis", async () => {
    const { body } = await json("/api/board");
    expect(body.columns).toHaveLength(9);
    const analysis = body.columns.find((c: { stageKey: string }) => c.stageKey === "analysis");
    expect(analysis.cards.map((c: { id: string }) => c.id)).toEqual(["t1"]);
  });

  it("GET /api/attention lists the gated task", async () => {
    const { body } = await json("/api/attention");
    expect(body.items).toEqual([{ taskId: "t1", title: "Refund API", stageKey: "analysis" }]);
  });

  it("GET /api/tasks lists tasks", async () => {
    const { body } = await json("/api/tasks");
    expect(body.tasks.map((t: { id: string }) => t.id)).toEqual(["t1"]);
  });

  it("GET /api/tasks/:id returns task + stages + steps + costs", async () => {
    const { status, body } = await json("/api/tasks/t1");
    expect(status).toBe(200);
    expect(body.task.id).toBe("t1");
    expect(body.stages).toHaveLength(9);
    expect(body.steps.map((s: { id: string }) => s.id)).toEqual(["s1"]);
    expect(Array.isArray(body.costs)).toBe(true);
  });

  it("GET /api/tasks/:id 404 for missing", async () => {
    expect((await json("/api/tasks/nope")).status).toBe(404);
  });
});

describe("web api mutations", () => {
  async function post(path: string, body?: unknown) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("POST /api/tasks creates a task and it appears on the board", async () => {
    const r = await post("/api/tasks", { title: "New feature", repo: "app" });
    expect(r.status).toBe(201);
    expect(r.body.task.title).toBe("New feature");
    const board = (await json("/api/board")).body;
    const analysis = board.columns.find((c: { stageKey: string }) => c.stageKey === "analysis");
    expect(analysis.cards.some((c: { id: string }) => c.id === r.body.task.id)).toBe(true);
  });

  it("POST /api/tasks 400 without a title", async () => {
    expect((await post("/api/tasks", {})).status).toBe(400);
  });

  it("POST start → accept advances the stage", async () => {
    await post("/api/tasks", { id: "m1", title: "M" });
    expect((await post("/api/tasks/m1/start")).body.active).toBe("analysis");
    expect((await post("/api/tasks/m1/stages/analysis/accept")).body.next).toBe("brainstorm");
  });

  it("POST gate toggles the stage gate", async () => {
    await post("/api/tasks", { id: "m2", title: "M2" });
    await post("/api/tasks/m2/stages/spec/gate", { gate: false });
    const detail = (await json("/api/tasks/m2")).body;
    expect(detail.stages.find((s: { stage_key: string }) => s.stage_key === "spec").gate).toBe(0);
  });

  it("mutation on missing task → 404", async () => {
    expect((await post("/api/tasks/ghost/start")).status).toBe(404);
  });
});
