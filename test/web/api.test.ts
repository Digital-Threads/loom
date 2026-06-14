import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../src/core/store/db.js";
import { createStep } from "../../src/core/store/steps.js";
import { startTask } from "../../src/core/pipeline/engine.js";
import { createApi } from "../../src/web/api.js";
import { createRunManager } from "../../src/core/automation/run-manager.js";
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

  // ── projects (D3) ──
  it("GET /api/projects lists projects + active (D3)", async () => {
    const proj = { projectId: "p1", root: "/r", name: "r", addedAt: 0 };
    const app2 = createApi(db, { listProjects: () => [proj], activeProject: () => proj });
    expect(await (await app2.request("/api/projects")).json()).toEqual({ projects: [proj], active: "p1" });
  });

  it("POST /api/projects adds; requires root (D3)", async () => {
    const added: string[] = [];
    const app2 = createApi(db, {
      addProject: (root) => { added.push(root); return { projectId: "px", root, name: "x", addedAt: 0 }; },
    });
    const ok = await app2.request("/api/projects", { method: "POST", body: JSON.stringify({ root: "/repo" }) });
    expect(ok.status).toBe(201);
    expect(added).toEqual(["/repo"]);
    const bad = await app2.request("/api/projects", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);
  });

  it("POST /api/projects/active switches; unknown → 404 (D3)", async () => {
    const app2 = createApi(db, { setActiveProject: (id) => id === "p1" });
    expect((await app2.request("/api/projects/active", { method: "POST", body: JSON.stringify({ projectId: "p1" }) })).status).toBe(200);
    expect((await app2.request("/api/projects/active", { method: "POST", body: JSON.stringify({ projectId: "zz" }) })).status).toBe(404);
  });

  it("GET /api/workspace?project resolves the project root (D3)", async () => {
    const roots: (string | undefined)[] = [];
    const app2 = createApi(db, {
      listProjects: () => [{ projectId: "p1", root: "/repoA", name: "a", addedAt: 0 }],
      loadWorkspace: async (root) => { roots.push(root); return { projectId: "p1" } as never; },
    });
    await app2.request("/api/workspace?project=p1");
    await app2.request("/api/workspace");
    expect(roots).toEqual(["/repoA", undefined]);
  });

  // ── runs (L4.4) ──
  it("POST /api/tasks/:id/stages/:key/run starts a run (L4.4)", async () => {
    const calls: [string, string][] = [];
    const app2 = createApi(db, { startRun: (id, key) => { calls.push([id, key]); return "run_abc"; } });
    const res = await app2.request("/api/tasks/t1/stages/rd/run", { method: "POST" });
    expect(await res.json()).toEqual({ runId: "run_abc" });
    expect(calls).toEqual([["t1", "rd"]]);
    const nf = await app2.request("/api/tasks/zzz/stages/rd/run", { method: "POST" });
    expect(nf.status).toBe(404);
  });

  it("GET /api/runs/:runId returns a snapshot (L4.4)", async () => {
    const rm = createRunManager();
    const runId = rm.start({ projectId: "p1", toBus: false }, async (ctx) => { ctx.appendOutput("hi"); return 1; });
    await rm.wait(runId);
    const app2 = createApi(db, { runManager: rm });
    const body = (await (await app2.request(`/api/runs/${runId}`)).json()) as { status: string; output: string[] };
    expect(body.status).toBe("done");
    expect(body.output).toEqual(["hi"]);
    expect((await app2.request("/api/runs/nope")).status).toBe(404);
  });

  it("GET /api/timeline returns the project events time-ordered (L9.4)", async () => {
    const e = (ts: number, type: string) => ({ schema: "loom.event.v1", ts, source: "loom", projectId: "p1", type });
    const app2 = createApi(db, {
      activeProject: () => ({ projectId: "p1", root: "/r", name: "r", addedAt: 0 }),
      loadEvents: () => [e(3, "c") as never, e(1, "a") as never, e(2, "b") as never],
    });
    const body = (await (await app2.request("/api/timeline")).json()) as { events: { type: string }[] };
    expect(body.events.map((x) => x.type)).toEqual(["a", "b", "c"]);
  });

  // ── conductor (L13) ──
  it("POST /advance drives the task through its route via injected runners (L13)", async () => {
    // fresh autopilot task with a short route
    const { createTask } = await import("../../src/core/store/db.js");
    const { startTask } = await import("../../src/core/pipeline/engine.js");
    createTask(db, { id: "tc", title: "C", route: ["analysis", "impl", "done"], run_mode: "autopilot" });
    startTask(db, "tc");
    const ran: string[] = [];
    const mk = (k: string) => async () => { ran.push(k); return { ok: true }; };
    const app2 = createApi(db, { runners: { analysis: mk("analysis"), impl: mk("impl"), done: mk("done") } });
    const r = (await (await app2.request("/api/tasks/tc/advance", { method: "POST" })).json()) as { ran: string[]; stoppedAt: string | null };
    expect(r.ran).toEqual(["analysis", "impl", "done"]);
    expect(r.stoppedAt).toBeNull();
  });

  // ── PR / Done (L14) ──
  it("POST /pr/run returns a description; /done/run finalizes (L14)", async () => {
    let closed = false;
    const app2 = createApi(db, {
      prOptions: () => ({ describe: () => "PR BODY" }),
      closeTask: () => { closed = true; },
    });
    const pr = (await (await app2.request("/api/tasks/t1/pr/run", { method: "POST" })).json()) as { pr: { description: string } };
    expect(pr.pr.description).toBe("PR BODY");
    const done = await (await app2.request("/api/tasks/t1/done/run", { method: "POST" })).json();
    expect(done).toEqual({ ok: true });
    expect(closed).toBe(true);
  });

  // ── extensibility (L11) ──
  it("GET /api/layers lists registered plugins with capabilities (L11)", async () => {
    const app2 = createApi(db);
    const body = (await (await app2.request("/api/layers")).json()) as { layers: { id: string }[] };
    expect(body.layers.map((l) => l.id).sort()).toEqual(["aimux", "task-journal", "token-pilot"]);
  });
  it("GET /api/skills lists slot contributions (L11)", async () => {
    const app2 = createApi(db);
    const body = (await (await app2.request("/api/skills")).json()) as { slots: unknown[] };
    expect(Array.isArray(body.slots)).toBe(true);
  });

  // ── quality (L6) ──
  it("GET /api/flow-config/:stage returns the resolved passes (L6)", async () => {
    const app2 = createApi(db);
    expect(await (await app2.request("/api/flow-config/review")).json()).toEqual({ passes: ["normal", "simplify"] });
  });

  it("POST /review/run aggregates findings + decides action (L6)", async () => {
    const app2 = createApi(db, {
      reviewPass: (key) => ({ key, run: async () => (key === "adversarial" ? [{ pass: key, severity: "bug" as const, message: "leak" }] : []) }),
    });
    const clean = (await (await app2.request("/api/tasks/t1/review/run", { method: "POST", body: "{}" })).json()) as { result: { passed: boolean }; action: string };
    expect(clean.result.passed).toBe(true);
    expect(clean.action).toBe("accept");
    const bug = (await (await app2.request("/api/tasks/t1/review/run", { method: "POST", body: JSON.stringify({ passes: ["adversarial"], mode: "triage" }) })).json()) as { result: { passed: boolean }; action: string };
    expect(bug.result.passed).toBe(false);
    expect(bug.action).toBe("return");
  });

  it("POST /qa/run runs the injected checks (L6)", async () => {
    const app2 = createApi(db, {
      qaChecks: () => [{ key: "tests", async run() { return { ok: true }; } }, { key: "build", async run() { return { ok: false, output: "err" }; } }],
    });
    const r = (await (await app2.request("/api/tasks/t1/qa/run", { method: "POST", body: "{}" })).json()) as { result: { passed: boolean } };
    expect(r.result.passed).toBe(false);
  });

  // ── dialog stages (L12) ──
  it("analysis/brainstorm/spec endpoints drive the dialog stages (L12.5)", async () => {
    let n = 0;
    const stageAgent = async (prompt: string) => {
      if (prompt.includes("Classify")) return '{"class":"feature","route":["analysis","spec","impl","done"]}';
      if (prompt.includes("Summarise")) return "BRIEF";
      if (prompt.includes("Write an SDD")) return "# SDD";
      return `q${++n}?`;
    };
    const app2 = createApi(db, { stageAgent });

    const analysis = (await (await app2.request("/api/tasks/t1/analysis/run", { method: "POST" })).json()) as { class: string; route: string[] };
    expect(analysis.class).toBe("feature");
    expect(analysis.route).toContain("spec");

    await app2.request("/api/tasks/t1/brainstorm/message", { method: "POST", body: JSON.stringify({ message: "hi" }) });
    const msgs = (await (await app2.request("/api/tasks/t1/brainstorm/messages")).json()) as { messages: unknown[] };
    expect(msgs.messages.length).toBeGreaterThan(0);
    const done = (await (await app2.request("/api/tasks/t1/brainstorm/done", { method: "POST" })).json()) as { summary: { content: string } };
    expect(done.summary.content).toBe("BRIEF");

    const draft = (await (await app2.request("/api/tasks/t1/spec/draft", { method: "POST" })).json()) as { spec: { content: string; version: number } };
    expect(draft.spec.content).toBe("# SDD");
    const accepted = (await (await app2.request("/api/tasks/t1/spec/accept", { method: "POST" })).json()) as { spec: { status: string } };
    expect(accepted.spec.status).toBe("accepted");
  });

  it("GET /api/knowledge/recall partitions hits into decisions/rejections (L7)", async () => {
    const app2 = createApi(db, {
      recall: (q) => [
        { taskId: "tj-1", projectHash: "h", eventType: "decision", text: `chose ${q}`, score: 1 },
        { taskId: "tj-2", projectHash: "h", eventType: "rejection", text: `ruled out ${q}`, score: 1 },
      ],
    });
    const body = (await (await app2.request("/api/knowledge/recall?q=axum")).json()) as {
      decisions: { text: string }[]; rejections: { text: string }[];
    };
    expect(body.decisions[0].text).toContain("chose axum");
    expect(body.rejections[0].text).toContain("ruled out axum");
    // empty query → no hits, no recall call
    const empty = await (await app2.request("/api/knowledge/recall")).json();
    expect(empty).toMatchObject({ hits: [], decisions: [], rejections: [] });
  });

  it("GET /api/metrics/board sums token totals (L9.2)", async () => {
    const tp = (used: number, saved: number) => ({ schema: "loom.event.v1", ts: 1, source: "token-pilot", projectId: "p1", type: "tokens", metrics: { used, saved } });
    const app2 = createApi(db, {
      activeProject: () => ({ projectId: "p1", root: "/r", name: "r", addedAt: 0 }),
      loadEvents: () => [tp(10, 2) as never, tp(5, 1) as never],
    });
    expect(await (await app2.request("/api/metrics/board")).json()).toMatchObject({ used: 15, saved: 3 });
  });

  it("GET /api/runs/:runId/stream streams events then a final status (L4.4)", async () => {
    const rm = createRunManager();
    const runId = rm.start({ projectId: "p1", toBus: false }, async (ctx) => {
      ctx.emit({ schema: "loom.event.v1", ts: 1, source: "loom", projectId: "p1", type: "run.started" });
      return 1;
    });
    await rm.wait(runId);
    const app2 = createApi(db, { runManager: rm });
    const res = await app2.request(`/api/runs/${runId}/stream`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("run.started");
    expect(text).toContain('"status":"done"');
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
