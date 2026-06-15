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

  it("POST /api/accounts/subscription adds via aimux (D5.1)", async () => {
    const added: string[] = [];
    const app2 = createApi(db, { addSubscription: (name) => { added.push(name); return { ok: true }; } });
    const ok = await app2.request("/api/accounts/subscription", { method: "POST", body: JSON.stringify({ name: "work" }) });
    expect(await ok.json()).toMatchObject({ ok: true });
    expect(added).toEqual(["work"]);
    expect((await app2.request("/api/accounts/subscription", { method: "POST", body: "{}" })).status).toBe(400);
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

  it("POST /api/runs/:runId/stdin injects input into a live run (loom-isd.13)", async () => {
    const rm = createRunManager();
    const received: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runId = rm.start({ projectId: "p1", toBus: false }, async (ctx) => {
      ctx.onInput((data) => received.push(data));
      await gate;
      return received.length;
    });
    const app2 = createApi(db, { runManager: rm });
    const res = await app2.request(`/api/runs/${runId}/stdin`, {
      method: "POST",
      body: JSON.stringify({ data: "y\n" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
    expect(received).toEqual(["y\n"]);
    release();
    await rm.wait(runId);
    expect((await app2.request("/api/runs/nope/stdin", { method: "POST", body: "{}" })).status).toBe(404);
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

  it("GET /api/knowledge/search returns semantic hits (L7.2)", async () => {
    const app2 = createApi(db, { search: (q) => [{ taskId: "t", projectHash: "h", eventType: "decision", text: `match ${q}`, score: 1 }] });
    const r = (await (await app2.request("/api/knowledge/search?q=axum")).json()) as { hits: { text: string }[] };
    expect(r.hits[0].text).toBe("match axum");
    expect(await (await app2.request("/api/knowledge/search")).json()).toEqual({ hits: [] });
  });

  it("GET /api/knowledge/graph derives nodes/edges from recall (L7.3)", async () => {
    const app2 = createApi(db, {
      recall: () => [
        { taskId: "t", projectHash: "h", eventType: "decision", text: "a", score: 1 },
        { taskId: "t", projectHash: "h", eventType: "rejection", text: "b", score: 1 },
      ],
    });
    const g = (await (await app2.request("/api/knowledge/graph?q=x")).json()) as { nodes: unknown[]; edges: unknown[] };
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
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

  // ── connectors MCP (D5) ──
  it("MCP add/list/toggle/test via /api/connectors/mcp (D5)", async () => {
    const app2 = createApi(db, { mcpProbe: () => ({ code: 0 }) });
    expect((await app2.request("/api/connectors/mcp", { method: "POST", body: JSON.stringify({ id: "fs", command: "mcp-fs" }) })).status).toBe(201);
    const list = (await (await app2.request("/api/connectors/mcp")).json()) as { servers: { id: string }[] };
    expect(list.servers.map((s) => s.id)).toContain("fs");
    expect((await app2.request("/api/connectors/mcp/fs/toggle", { method: "POST", body: JSON.stringify({ enabled: false }) })).status).toBe(200);
    expect(await (await app2.request("/api/connectors/mcp/fs/test", { method: "POST" })).json()).toMatchObject({ ok: true });
    await app2.request("/api/connectors/mcp/fs/remove", { method: "POST" });
  });

  it("POST /api/connectors/import creates tasks from drafts (D5.4)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "Imported A" }, { title: "Imported B", description: "d" }] });
    const r = (await (await app2.request("/api/connectors/import", { method: "POST" })).json()) as { created: number };
    expect(r.created).toBe(2);
  });

  // ── settings / attachments (D6) ──
  it("settings round-trip via /api/settings (D6)", async () => {
    const app2 = createApi(db);
    await app2.request("/api/settings", { method: "POST", body: JSON.stringify({ key: "run_mode", value: "autopilot" }) });
    expect(await (await app2.request("/api/settings")).json()).toMatchObject({ run_mode: "autopilot" });
  });
  it("attachments add + list, validation (D6)", async () => {
    const app2 = createApi(db);
    const created = await app2.request("/api/tasks/t1/attachments", { method: "POST", body: JSON.stringify({ kind: "link", name: "spec", pathOrUrl: "https://x" }) });
    expect(created.status).toBe(201);
    const list = (await (await app2.request("/api/tasks/t1/attachments")).json()) as { attachments: unknown[] };
    expect(list.attachments).toHaveLength(1);
    expect((await app2.request("/api/tasks/t1/attachments", { method: "POST", body: "{}" })).status).toBe(400);
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

  it("POST move repositions the task to a stage column", async () => {
    await post("/api/tasks", { id: "mv1", title: "Move" });
    await post("/api/tasks/mv1/start");
    expect((await post("/api/tasks/mv1/move", { stageKey: "spec" })).body.current).toBe("spec");
    const board = (await json("/api/board")).body;
    const spec = board.columns.find((c: { stageKey: string }) => c.stageKey === "spec");
    expect(spec.cards.some((c: { id: string }) => c.id === "mv1")).toBe(true);
  });

  it("POST move with an unknown stage → 400", async () => {
    await post("/api/tasks", { id: "mv2", title: "Move2" });
    expect((await post("/api/tasks/mv2/move", { stageKey: "nope" })).status).toBe(400);
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

describe("web api — fs browse + PR connector", () => {
  let d: string;
  let database: Database.Database;

  beforeEach(() => {
    d = mkdtempSync(join(tmpdir(), "loom-api2-"));
    database = openStore(join(d, "test.db"));
  });
  afterEach(() => {
    database.close();
    rmSync(d, { recursive: true, force: true });
  });

  it("review/qa results persist and re-display via GET (stage history)", async () => {
    createTask(database, { id: "h1", title: "History" });
    const a = createApi(database, {
      reviewPass: (key) => ({ key, run: async () => [] }),
      qaChecks: () => [{ key: "tests", run: async () => ({ ok: true, output: "ok" }) }],
    });
    // initially nothing stored
    expect(((await (await a.request("/api/tasks/h1/review")).json()) as { result: unknown }).result).toBeNull();
    // run → persisted
    await a.request("/api/tasks/h1/review/run", { method: "POST", body: "{}" });
    await a.request("/api/tasks/h1/qa/run", { method: "POST", body: "{}" });
    const review = (await (await a.request("/api/tasks/h1/review")).json()) as { result: { passed: boolean } | null };
    const qa = (await (await a.request("/api/tasks/h1/qa")).json()) as { result: { passed: boolean } | null };
    expect(review.result?.passed).toBe(true);
    expect(qa.result?.passed).toBe(true);
  });

  it("stage run streams the live session output into the run record", async () => {
    createTask(database, { id: "st", title: "Stream", run_mode: "manual" });
    const sessionLauncher = {
      run: async (_p: string, opts: { onChunk?: (c: string) => void }) => { opts.onChunk?.("live-chunk"); return { text: "done" }; },
      denialsOf: () => [],
    };
    const rm = createRunManager();
    const a = createApi(database, { sessionLauncher, runManager: rm });
    await a.request("/api/tasks/st/start", { method: "POST" });
    await a.request("/api/tasks/st/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "rd" }) });
    const { runId } = (await (await a.request("/api/tasks/st/stages/rd/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    expect(rm.get(runId)!.output.join("")).toContain("live-chunk"); // streamed to the run → SSE
  });

  it("manual: safe allowlist passed, denials surfaced, approve widens the allowlist", async () => {
    createTask(database, { id: "pm", title: "Perm", run_mode: "manual" });
    let seenAllowed: string[] | undefined;
    const sessionLauncher = {
      run: async (_p: string, opts: { allowedTools?: string[] }) => { seenAllowed = opts.allowedTools; return { text: "{}" }; },
      denialsOf: () => ["Bash"],
    };
    const a = createApi(database, { sessionLauncher });
    await a.request("/api/tasks/pm/analysis/run", { method: "POST", body: "{}" });
    expect(seenAllowed).toContain("Read");
    expect(seenAllowed).toContain("Bash(git *)");

    const p1 = (await (await a.request("/api/tasks/pm/permissions")).json()) as { denials: string[]; allowed: string[] };
    expect(p1.denials).toContain("Bash"); // agent tried Bash → blocked, awaiting approval

    await a.request("/api/tasks/pm/permissions/allow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "Bash" }) });
    const p2 = (await (await a.request("/api/tasks/pm/permissions")).json()) as { denials: string[]; allowed: string[] };
    expect(p2.allowed).toContain("Bash"); // approved → in the allowlist
    expect(p2.denials).not.toContain("Bash"); // no longer pending

    // argv smuggling rejected: a flag-shaped "tool" must not be persisted
    const bad = await a.request("/api/tasks/pm/permissions/allow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "--dangerously-skip-permissions" }) });
    expect(bad.status).toBe(400);
    const p3 = (await (await a.request("/api/tasks/pm/permissions")).json()) as { allowed: string[] };
    expect(p3.allowed).not.toContain("--dangerously-skip-permissions");
  });

  it("autopilot tasks bypass permissions; manual/gated do not", async () => {
    const bypass: Record<string, boolean | undefined> = {};
    const mk = (id: string, run_mode: string) => {
      createTask(database, { id, title: id, run_mode });
      const sessionLauncher = {
        run: async (_p: string, opts: { bypassPermissions?: boolean }) => { bypass[id] = opts.bypassPermissions; return { text: "{}" }; },
      };
      return createApi(database, { sessionLauncher });
    };
    await mk("auto1", "autopilot").request("/api/tasks/auto1/analysis/run", { method: "POST", body: "{}" });
    await mk("man1", "manual").request("/api/tasks/man1/analysis/run", { method: "POST", body: "{}" });
    expect(bypass.auto1).toBe(true); // autopilot = full access (user-warned)
    expect(bypass.man1).toBe(false); // manual = normal permissions
  });

  it("injects spine env (LOOM_TASK_ID) into the session and records cost", async () => {
    createTask(database, { id: "cst", title: "Cost" });
    let seenEnv: Record<string, string> | undefined;
    const sessionLauncher = {
      run: async (_p: string, opts: { env?: Record<string, string> }) => {
        seenEnv = opts.env;
        return { text: '{"class":"feature","route":["analysis"]}' };
      },
      costOf: () => 0.05,
    };
    const a = createApi(database, { sessionLauncher });
    await a.request("/api/tasks/cst/analysis/run", { method: "POST", body: "{}" });
    expect(seenEnv?.LOOM_TASK_ID).toBe("cst"); // telemetry attributes to this task
    const detail = (await (await a.request("/api/tasks/cst")).json()) as { costs: { source: string; metric: string }[] };
    expect(detail.costs.some((c) => c.source === "token-pilot")).toBe(true); // used/saved pulled from token-pilot stats
  });

  it("dialog stages run through ONE persistent task session (create → resume)", async () => {
    createTask(database, { id: "sx", title: "Sess" });
    const calls: Array<{ resume: boolean; sessionId: string }> = [];
    const sessionLauncher = {
      run: async (_p: string, opts: { resume: boolean; sessionId: string }) => {
        calls.push({ resume: opts.resume, sessionId: opts.sessionId });
        return { text: '{"class":"feature","route":["analysis","spec"]}' };
      },
    };
    const a = createApi(database, { sessionLauncher });
    await a.request("/api/tasks/sx/analysis/run", { method: "POST", body: "{}" });
    await a.request("/api/tasks/sx/spec/draft", { method: "POST", body: "{}" });
    expect(calls).toHaveLength(2);
    expect(calls[0].resume).toBe(false); // first stage creates the session
    expect(calls[1].resume).toBe(true); //  next stage resumes it
    expect(calls[0].sessionId).toBe(calls[1].sessionId); // same session across stages
  });

  it("R&D stage produces a plan (no code) and honours the completeness-gate", async () => {
    async function runRd(taskId: string, marker: string) {
      createTask(database, { id: taskId, title: "Plan" });
      const sessionLauncher = { run: async () => ({ text: `План:\n- подзадача 1\n${marker}` }) };
      const a = createApi(database, { sessionLauncher });
      await a.request(`/api/tasks/${taskId}/start`, { method: "POST" });
      await a.request(`/api/tasks/${taskId}/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "rd" }) });
      const res = await a.request(`/api/tasks/${taskId}/run-stage`, { method: "POST", body: "{}" });
      const body = (await res.json()) as { stoppedAt: string | null };
      // the plan was stored as an artifact for review
      const stored = (await (await a.request(`/api/tasks/${taskId}`)).json()) as { task: unknown };
      return { stoppedAt: body.stoppedAt, hasTask: !!stored.task };
    }
    const parked = await runRd("rdA", "ИТОГ: НЕ ГОТОВО — мало данных");
    expect(parked.stoppedAt).toBe("rd"); // doubtful plan parks
    const advanced = await runRd("rdB", "ИТОГ: ГОТОВО");
    expect(advanced.stoppedAt).not.toBe("rd"); // ready plan moves on
  });

  it("completeness-gate: spec parks on НЕ ГОТОВО, advances on ГОТОВО", async () => {
    async function runSpec(taskId: string, marker: string) {
      createTask(database, { id: taskId, title: "Gate" });
      const sessionLauncher = { run: async () => ({ text: `# SDD\n...\n${marker}` }) };
      const a = createApi(database, { sessionLauncher });
      await a.request(`/api/tasks/${taskId}/start`, { method: "POST" });
      await a.request(`/api/tasks/${taskId}/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "spec" }) });
      const res = await a.request(`/api/tasks/${taskId}/run-stage`, { method: "POST", body: "{}" });
      return (await res.json()) as { ran: string[]; stoppedAt: string | null };
    }
    const parked = await runSpec("gateA", "ИТОГ: НЕ ГОТОВО — нужны уточнения");
    expect(parked.stoppedAt).toBe("spec"); // doubtful spec does not advance

    const advanced = await runSpec("gateB", "ИТОГ: ГОТОВО");
    expect(advanced.stoppedAt).not.toBe("spec"); // ready spec moves on
  });

  it("GET /favicon.ico returns 204 (no console 404)", async () => {
    const a = createApi(database);
    expect((await a.request("/favicon.ico")).status).toBe(204);
  });

  it("GET /api/fs/list lists sub-directories of a path", async () => {
    const a = createApi(database);
    const res = await a.request(`/api/fs/list?path=${encodeURIComponent(d)}`);
    const body = (await res.json()) as { path: string; parent: string | null; entries: unknown[] };
    expect(res.status).toBe(200);
    expect(body.path).toBe(d);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("POST /api/tasks/:id/pr/run with connector pushes the branch and opens a PR", async () => {
    createTask(database, { id: "p1", title: "Ship it", repo: "/repo", branch: "main" });
    const calls: Array<[string, string[]]> = [];
    const sh = (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { code: 0, stdout: "https://github.com/x/y/pull/1\n" };
    };
    const a = createApi(database, { prOptions: () => ({ sh }) });
    const res = await a.request("/api/tasks/p1/pr/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector: true }),
    });
    const body = (await res.json()) as { pr: { created: boolean; url?: string } };
    expect(body.pr.created).toBe(true);
    expect(body.pr.url).toBe("https://github.com/x/y/pull/1");
    expect(calls[0]).toEqual(["git", ["push", "-u", "origin", "loom/p1"]]);
    expect(calls[1][0]).toBe("gh");
    expect(calls[1][1]).toContain("--head");
    expect(calls[1][1]).toContain("loom/p1");
  });

  it("PR connector without a repo → 400", async () => {
    createTask(database, { id: "p2", title: "No repo" });
    const a = createApi(database);
    const res = await a.request("/api/tasks/p2/pr/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector: true }),
    });
    expect(res.status).toBe(400);
  });

  it("PR without connector stays description-only (no push)", async () => {
    createTask(database, { id: "p3", title: "Draft only", repo: "/repo" });
    const a = createApi(database);
    const res = await a.request("/api/tasks/p3/pr/run", { method: "POST", body: "{}" });
    const body = (await res.json()) as { pr: { created: boolean } };
    expect(body.pr.created).toBe(false);
  });
});
