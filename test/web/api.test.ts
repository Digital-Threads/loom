import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask } from "../../src/core/store/db.js";
import { listRunsForTask, insertRun, reconcileInterruptedRuns } from "../../src/core/store/execute.js";
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
    expect(await res.json()).toMatchObject(ws); // endpoint also adds activeProfile
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
    const rm = createRunManager();
    const app2 = createApi(db, { runManager: rm, runners: { analysis: mk("analysis"), impl: mk("impl"), done: mk("done") } });
    const { runId } = (await (await app2.request("/api/tasks/tc/advance", { method: "POST" })).json()) as { runId: string };
    const rec = await rm.wait(runId); // advance streams via the run-manager now
    const res = rec.result as { ran: string[]; stoppedAt: string | null };
    expect(res.ran).toEqual(["analysis", "impl", "done"]);
    expect(res.stoppedAt).toBeNull();
    expect(ran).toEqual(["analysis", "impl", "done"]);
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

  it("POST /review/run steps through reviewers, accumulating findings (L6)", async () => {
    const app2 = createApi(db, {
      reviewPass: (key) => ({ key, run: async () => (key === "adversarial" ? [{ pass: key, severity: "bug" as const, message: "leak" }] : []) }),
    });
    // First run (no reviewer specified) = the first reviewer "self" — clean.
    const self = (await (await app2.request("/api/tasks/t1/review/run", { method: "POST", body: "{}" })).json()) as { result: { passed: boolean }; action: string; ran: string; next: string };
    expect(self.ran).toBe("self");
    expect(self.result.passed).toBe(true);
    expect(self.action).toBe("accept");
    expect(self.next).toBe("ralph");
    // Explicit adversarial reviewer finds a bug → accumulated → review fails.
    const adv = (await (await app2.request("/api/tasks/t1/review/run", { method: "POST", body: JSON.stringify({ reviewer: "adversarial" }) })).json()) as { result: { passed: boolean; findings: unknown[] }; action: string; reviewersDone: string[] };
    expect(adv.result.passed).toBe(false);
    expect(adv.action).toBe("return");
    expect(adv.result.findings.length).toBe(1);
    expect(adv.reviewersDone).toEqual(["self", "adversarial"]);
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

  it("completing a stage moves the task to the next board column", async () => {
    await post("/api/tasks", { id: "bm", title: "BoardMove" });
    await post("/api/tasks/bm/start"); // analysis active → card sits in the analysis column
    const colOf = async (id: string) => {
      const board = (await json("/api/board")).body as { columns: { stageKey: string; cards: { id: string }[] }[] };
      return board.columns.find((c) => c.cards.some((x) => x.id === id))?.stageKey;
    };
    expect(await colOf("bm")).toBe("analysis");
    await post("/api/tasks/bm/stages/analysis/accept"); // finishing analysis advances it
    expect(await colOf("bm")).toBe("brainstorm"); // card moved on the board
  });

  it("POST move with an unknown stage → 400", async () => {
    await post("/api/tasks", { id: "mv2", title: "Move2" });
    expect((await post("/api/tasks/mv2/move", { stageKey: "nope" })).status).toBe(400);
  });

  it("POST move with run:true starts the dropped stage in the task session (board DnD)", async () => {
    const calls: [string, string][] = [];
    const app2 = createApi(db, { startRun: (id, key) => { calls.push([id, key]); return "run_dnd"; } });
    const mk = (p: string, b?: unknown) => app2.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
    await mk("/api/tasks", { id: "dnd1", title: "DnD" });
    await mk("/api/tasks/dnd1/start");
    const out = await (await mk("/api/tasks/dnd1/move", { stageKey: "rd", run: true })).json();
    expect(out.current).toBe("rd");
    expect(out.runId).toBe("run_dnd");
    expect(calls).toEqual([["dnd1", "rd"]]);
  });

  it("POST move without run does not start a run (repositions only)", async () => {
    const calls: string[] = [];
    const app2 = createApi(db, { startRun: (id) => { calls.push(id); return "x"; } });
    const mk = (p: string, b?: unknown) => app2.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
    await mk("/api/tasks", { id: "dnd2", title: "D2" });
    await mk("/api/tasks/dnd2/start");
    const out = await (await mk("/api/tasks/dnd2/move", { stageKey: "rd" })).json();
    expect(out.runId).toBeUndefined();
    expect(calls).toEqual([]);
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

  it("GET /file reads a file inside the task repo; rejects traversal", async () => {
    writeFileSync(join(d, "spec.md"), "# Hello\n\nbody");
    createTask(database, { id: "fr", title: "FileRead", repo: d });
    const a = createApi(database);
    const ok = await a.request("/api/tasks/fr/file?path=spec.md");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { content: string }).content).toContain("# Hello");
    // traversal out of the repo → 403
    const bad = await a.request(`/api/tasks/fr/file?path=${encodeURIComponent("../../etc/passwd")}`);
    expect(bad.status).toBe(403);
    // missing path → 400
    expect((await a.request("/api/tasks/fr/file")).status).toBe(400);
    // a symlink planted in the repo that points OUTSIDE it → 403 (realpath check)
    symlinkSync("/etc/hostname", join(d, "escape.md"));
    const sym = await a.request("/api/tasks/fr/file?path=escape.md");
    expect(sym.status).toBe(403);
  });

  it("GET /diff returns empty for a non-git repo (no crash)", async () => {
    createTask(database, { id: "df", title: "Diff", repo: d }); // d is a plain dir, not a git repo
    const a = createApi(database);
    const r = (await (await a.request("/api/tasks/df/diff")).json()) as { diff: string; base: string | null };
    expect(r.diff).toBe("");
    expect(r.base).toBeNull();
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

  // Every stage must leave a readable turn in the shared transcript — otherwise
  // running review/qa/pr/done/brainstorm shows nothing (the "done but empty" bug).
  const transcriptOf = async (a: ReturnType<typeof createApi>, id: string) =>
    ((await (await a.request(`/api/tasks/${id}/transcript`)).json()) as { turns: { stage: string; output: string }[] }).turns;

  it("review run leaves a readable turn (findings visible in the transcript)", async () => {
    createTask(database, { id: "rv", title: "Rev", run_mode: "manual" });
    const rm = createRunManager();
    const a = createApi(database, { runManager: rm, reviewPass: (key) => ({ key, run: async () => [{ pass: key, severity: "warn" as const, message: "edge case X", file: "a.ts" }] }) });
    await a.request("/api/tasks/rv/start", { method: "POST" });
    await a.request("/api/tasks/rv/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "review" }) });
    const { runId } = (await (await a.request("/api/tasks/rv/stages/review/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    expect((await transcriptOf(a, "rv")).some((t) => t.stage === "review" && /edge case X/.test(t.output))).toBe(true);
  });

  it("review fix moves to impl, re-reviews, and returns to review (clean)", async () => {
    createTask(database, { id: "rf", title: "RF", run_mode: "manual" });
    const rm = createRunManager();
    let calls = 0;
    const a = createApi(database, {
      runManager: rm,
      stageAgent: async () => "исправил\nИТОГ: ГОТОВО",
      reviewPass: (key) => ({ key, run: async () => (calls++ === 0 ? [{ pass: key, severity: "bug" as const, message: "boom" }] : []) }),
    });
    await a.request("/api/tasks/rf/start", { method: "POST" });
    await a.request("/api/tasks/rf/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "review" }) });
    const r1 = (await (await a.request("/api/tasks/rf/stages/review/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(r1.runId); // first review finds a bug → parks on review
    const r2 = (await (await a.request("/api/tasks/rf/review/fix", { method: "POST" })).json()) as { runId: string };
    await rm.wait(r2.runId);
    const stages = (await (await a.request("/api/tasks/rf")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "review")!.status).toBe("active"); // back on review
    const rev = (await (await a.request("/api/tasks/rf/review")).json()) as { result: { passed: boolean } };
    expect(rev.result.passed).toBe(true); // re-review came back clean
  });

  it("autopilot review runs all three reviewers, then auto-fixes and re-reviews", async () => {
    createTask(database, { id: "rap", title: "RAP", run_mode: "autopilot" });
    const rm = createRunManager();
    const ran: string[] = [];
    let sweep = 0; // first sweep finds; the re-review self pass comes back clean
    const a = createApi(database, {
      runManager: rm,
      stageAgent: async () => "исправил\nИТОГ: ГОТОВО", // drives the auto-fix sessionSend
      reviewPass: (key) => ({ key, run: async () => {
        ran.push(key);
        if (key === "adversarial") sweep = 1; // after the first full sweep, fixes land
        return key === "ralph" && sweep === 0 ? [{ pass: key, severity: "warn" as const, message: "loop found Y" }] : [];
      } }),
    });
    await a.request("/api/tasks/rap/start", { method: "POST" });
    await a.request("/api/tasks/rap/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "review" }) });
    const { runId } = (await (await a.request("/api/tasks/rap/stages/review/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    // all three reviewers, then a 4th "self" verify pass after the auto-fix
    expect(ran).toEqual(["self", "ralph", "adversarial", "self"]);
    const rev = (await (await a.request("/api/tasks/rap/review")).json()) as { result: { findings: unknown[] }; reviewersDone: string[] };
    expect(rev.reviewersDone).toEqual(["self"]); // pipeline reset by the re-review
    expect(rev.result.findings.length).toBe(0); // re-review came back clean
  });

  it("review fix with no findings → 400", async () => {
    createTask(database, { id: "rf0", title: "RF0" });
    const a = createApi(database);
    expect((await a.request("/api/tasks/rf0/review/fix", { method: "POST" })).status).toBe(400);
  });

  it("qa run leaves a readable turn (check results visible)", async () => {
    createTask(database, { id: "qa1", title: "QA", run_mode: "manual" });
    const rm = createRunManager();
    const a = createApi(database, { runManager: rm, qaChecks: () => [{ key: "tests", run: async () => ({ ok: true, output: "5 passed" }) }] });
    await a.request("/api/tasks/qa1/start", { method: "POST" });
    await a.request("/api/tasks/qa1/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "qa" }) });
    const { runId } = (await (await a.request("/api/tasks/qa1/stages/qa/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    expect((await transcriptOf(a, "qa1")).some((t) => t.stage === "qa" && /tests/.test(t.output))).toBe(true);
  });

  it("pr run leaves a turn with the PR description", async () => {
    createTask(database, { id: "pr1", title: "PRtask" });
    const a = createApi(database, { prOptions: () => ({ describe: () => "PR: adds the thing" }) });
    await a.request("/api/tasks/pr1/pr/run", { method: "POST", body: "{}" });
    expect((await transcriptOf(a, "pr1")).some((t) => t.stage === "pr" && /adds the thing/.test(t.output))).toBe(true);
  });

  it("done run leaves a turn", async () => {
    createTask(database, { id: "dn1", title: "Donetask" });
    const a = createApi(database);
    await a.request("/api/tasks/dn1/done/run", { method: "POST" });
    expect((await transcriptOf(a, "dn1")).some((t) => t.stage === "done")).toBe(true);
  });

  it("brainstorm message leaves a turn (the agent's question is visible)", async () => {
    createTask(database, { id: "bs1", title: "BS" });
    // brainstorm runs through the task session → sessionSend records the turn.
    const sessionLauncher = { run: async () => ({ text: "What is the expected output format?" }), denialsOf: () => [] };
    const a = createApi(database, { sessionLauncher });
    await a.request("/api/tasks/bs1/brainstorm/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "build X" }) });
    const turns = await transcriptOf(a, "bs1");
    expect(turns.some((t) => t.stage === "brainstorm" && /expected output format/.test(t.output))).toBe(true);
  });

  it("a stage run is persisted to the runs table (durable)", async () => {
    createTask(database, { id: "dr", title: "Durable", run_mode: "manual" });
    const sessionLauncher = { run: async () => ({ text: "{}" }), denialsOf: () => [] };
    const a = createApi(database, { sessionLauncher }); // api's own persist-wired run-manager
    await a.request("/api/tasks/dr/start", { method: "POST" });
    await a.request("/api/tasks/dr/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "rd" }) });
    const { runId } = (await (await a.request("/api/tasks/dr/stages/rd/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    let done = false;
    for (let i = 0; i < 50 && !done; i++) {
      await new Promise((r) => setTimeout(r, 5));
      done = listRunsForTask(database, "dr").some((r) => r.id === runId && r.status === "done");
    }
    expect(done).toBe(true); // run row inserted on start + completed on settle
  });

  it("active-run returns the task's running run, then null once it settles", async () => {
    createTask(database, { id: "ar", title: "AR" });
    const rm = createRunManager();
    const a = createApi(database, { runManager: rm });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const runId = rm.start({ projectId: "p", taskId: "ar", toBus: false }, async () => { await gate; return 0; });
    const r1 = (await (await a.request("/api/tasks/ar/active-run")).json()) as { runId: string | null };
    expect(r1.runId).toBe(runId);
    release();
    await rm.wait(runId);
    const r2 = (await (await a.request("/api/tasks/ar/active-run")).json()) as { runId: string | null };
    expect(r2.runId).toBeNull();
  });

  it("reconcileInterruptedRuns marks stale running rows interrupted on boot", () => {
    createTask(database, { id: "rc", title: "Recon" });
    insertRun(database, { id: "run_stale", taskId: "rc" }); // left 'running' by a dead process
    expect(reconcileInterruptedRuns(database)).toBeGreaterThanOrEqual(1);
    expect(listRunsForTask(database, "rc")[0].status).toBe("interrupted");
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
    // a clean run completes the stage and activates the next (pipeline moves on).
    const stages = (await (await a.request("/api/tasks/st")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "rd")!.status).toBe("done");
    expect(stages.stages.find((s) => s.stage_key === "impl")!.status).toBe("active");
  });

  it("a parked stage (needs attention) stays active after a run", async () => {
    createTask(database, { id: "pk", title: "Park", run_mode: "manual" });
    const rm = createRunManager();
    // review with a bug-severity finding → not passed → needsAttention → stays put
    const a = createApi(database, { runManager: rm, reviewPass: (key) => ({ key, run: async () => [{ pass: key, severity: "bug" as const, message: "boom" }] }) });
    await a.request("/api/tasks/pk/start", { method: "POST" });
    await a.request("/api/tasks/pk/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "review" }) });
    const { runId } = (await (await a.request("/api/tasks/pk/stages/review/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    const stages = (await (await a.request("/api/tasks/pk")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "review")!.status).toBe("active");
  });

  it("impl stays active (parks) when the agent still lists remaining plan items", async () => {
    createTask(database, { id: "im", title: "Impl", run_mode: "manual" });
    const rm = createRunManager();
    // a ГОТОВО that still lists leftover epics is a lie — impl must NOT advance
    const a = createApi(database, { runManager: rm, stageAgent: async () => "Сделал RD-1.\nЧто из плана осталось (следующие эпики): RD-2, RD-3\nИТОГ: ГОТОВО" });
    await a.request("/api/tasks/im/start", { method: "POST" });
    await a.request("/api/tasks/im/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "impl" }) });
    const { runId } = (await (await a.request("/api/tasks/im/stages/impl/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    const stages = (await (await a.request("/api/tasks/im")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "impl")!.status).toBe("active");
  });

  it("impl completes when the agent reports the whole plan done", async () => {
    createTask(database, { id: "im2", title: "Impl2", run_mode: "manual" });
    const rm = createRunManager();
    const a = createApi(database, { runManager: rm, stageAgent: async () => "Весь план реализован и проверен, регрессий нет.\nИТОГ: ГОТОВО" });
    await a.request("/api/tasks/im2/start", { method: "POST" });
    await a.request("/api/tasks/im2/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "impl" }) });
    const { runId } = (await (await a.request("/api/tasks/im2/stages/impl/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    const stages = (await (await a.request("/api/tasks/im2")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "impl")!.status).toBe("done");
    expect(stages.stages.find((s) => s.stage_key === "review")!.status).toBe("active");
  });

  it("brainstorm Done → Spec advances to the spec stage", async () => {
    createTask(database, { id: "bd", title: "BD", run_mode: "manual" });
    const a = createApi(database, { stageAgent: async () => "requirements brief" });
    await a.request("/api/tasks/bd/start", { method: "POST" });
    await a.request("/api/tasks/bd/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "brainstorm" }) });
    const done = (await (await a.request("/api/tasks/bd/brainstorm/done", { method: "POST" })).json()) as { next: string | null };
    expect(done.next).toBe("spec");
    const stages = (await (await a.request("/api/tasks/bd")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "brainstorm")!.status).toBe("done");
    expect(stages.stages.find((s) => s.stage_key === "spec")!.status).toBe("active");
  });

  it("chat sends the message verbatim into the session and records a turn", async () => {
    createTask(database, { id: "ch", title: "Chat", run_mode: "manual" });
    let seenPrompt = "";
    const sessionLauncher = {
      run: async (p: string, opts: { onChunk?: (c: string) => void }) => { seenPrompt = p; opts.onChunk?.("reply"); return { text: "Понял, посмотрю файл X" }; },
      denialsOf: () => [],
    };
    const rm = createRunManager();
    const a = createApi(database, { sessionLauncher, runManager: rm });
    const res = await a.request("/api/tasks/ch/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "ты ошибся, глянь файл X", stage: "analysis" }) });
    const { runId } = (await res.json()) as { runId: string };
    await rm.wait(runId);
    expect(seenPrompt).toContain("ты ошибся, глянь файл X"); // verbatim, no stage wrapper
    expect(seenPrompt).not.toContain("Стадия:");
    expect(rm.get(runId)!.output.join("")).toContain("reply"); // streamed → SSE
    const turns = (await (await a.request("/api/tasks/ch/transcript")).json()) as { turns: { output: string }[] };
    expect(turns.turns.some((t) => t.output.includes("посмотрю файл X"))).toBe(true);
  });

  it("chat without a message → 400", async () => {
    createTask(database, { id: "ch2", title: "Chat2" });
    const a = createApi(database);
    const res = await a.request("/api/tasks/ch2/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "  " }) });
    expect(res.status).toBe(400);
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

    // MCP tool names (mcp__server__tool, hyphens allowed) must be approvable
    const mcp = "mcp__plugin_task-journal_task-journal__event_add";
    const okMcp = await a.request("/api/tasks/pm/permissions/allow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: mcp }) });
    expect(okMcp.status).toBe(200);
    expect(((await okMcp.json()) as { allowed: string[] }).allowed).toContain(mcp);
    // but a comma (csv injection into --allowedTools) is still rejected
    const comma = await a.request("/api/tasks/pm/permissions/allow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "Read,Bash" }) });
    expect(comma.status).toBe(400);
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
    const sh = async (cmd: string, args: string[]) => {
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
    expect(calls.some((c) => c[0] === "git" && c[1][0] === "push" && c[1].includes("loom/p1"))).toBe(true);
    const ghCreate = calls.find((c) => c[0] === "gh" && c[1][0] === "pr" && c[1][1] === "create");
    expect(ghCreate).toBeDefined();
    expect(ghCreate![1]).toContain("--head");
    expect(ghCreate![1]).toContain("loom/p1");
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

  it("PR result is persisted and re-readable via GET /pr", async () => {
    createTask(database, { id: "p4", title: "Persisted PR", repo: "/repo", description: "do the thing" });
    const a = createApi(database);
    await a.request("/api/tasks/p4/pr/run", { method: "POST", body: "{}" });
    const got = (await (await a.request("/api/tasks/p4/pr")).json()) as { pr: { description: string; created: boolean; connector: boolean } | null };
    expect(got.pr).not.toBeNull();
    expect(got.pr!.created).toBe(false);
    expect(got.pr!.connector).toBe(false);
    expect(got.pr!.description).toContain("Persisted PR");
  });
});
