import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, createTask, getTask, updateTaskStatus } from "../../src/core/store/db.js";
import { configureSecurity, securityDataDir, worktreeBranch } from "../../src/core/security/sandbox.js";
import { setSetting } from "../../src/core/store/settings.js";
import { listRunsForTask, insertRun, reconcileInterruptedRuns, upsertCost } from "../../src/core/store/execute.js";
import { createStep } from "../../src/core/store/steps.js";
import { addAttachment } from "../../src/core/store/attachments.js";
import { createArtifact } from "../../src/core/store/artifacts.js";
import { startTask, attentionQueue } from "../../src/core/pipeline/engine.js";
import { createApi, reviewersForClass, isFatalAgentError } from "../../src/web/api.js";
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

  it("GET /api/doctor returns the prereq report (D2.2)", async () => {
    const rep = { ok: false, tools: [{ name: "claude", found: false, hint: "install it" }], missing: ["claude"] };
    const app2 = createApi(db, { prereqs: () => rep });
    const res = await app2.request("/api/doctor");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rep);
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

  it("GET /api/memory/board/:id returns empty for a non-git task (no shared-project leak)", async () => {
    // t1 has no repo → no dedicated 1:1 journal project → must NOT dump the
    // host/shared project's unrelated tj tasks. Empty string, not a leak.
    const res = await app.request("/api/memory/board/t1");
    expect(res.status).toBe(200);
    expect((await res.json()).pack).toBe("");
  });

  it("GET /api/memory/board/:id is empty and never throws for an unknown id", async () => {
    // Unknown task → no dedicated journal project → empty, no throw.
    const res = await app.request("/api/memory/board/not-a-real-id");
    expect(res.status).toBe(200);
    expect((await res.json()).pack).toBe("");
  });

  it("GET /api/memory/board/:id falls back to the snapshot when the worktree journal is gone", async () => {
    // A git-repo task → its journal project is the (absent) worktree, so the
    // live read is empty and the Done-time snapshot must be used instead.
    createTask(db, { id: "t-snap", title: "Snapshot task", repo: process.cwd() });
    const events = [
      { event_id: "e1", task_id: "tj-z", type: "open", timestamp: "2026-06-18T10:00:00.000Z", text: "Snapshot reasoning task" },
      { event_id: "e2", task_id: "tj-z", type: "decision", timestamp: "2026-06-18T10:01:00.000Z", text: "snapshot decision kept" },
    ];
    createArtifact(db, { id: "art_snap", taskId: "t-snap", stage: "memory", kind: "journal-snapshot", content: JSON.stringify({ events }), status: "accepted" });
    const res = await app.request("/api/memory/board/t-snap");
    expect(res.status).toBe(200);
    expect((await res.json()).pack).toContain("snapshot decision kept");
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

  it("GET /api/timeline merges command-policy audit blocks as audit.command.blocked events (loom-block-audit)", async () => {
    const e = (ts: number, type: string) => ({ schema: "loom.event.v1", ts, source: "loom", projectId: "p1", type });
    const blockEvent = { schema: "loom.event.v1" as const, ts: 2, source: "loom" as const, projectId: "p1", type: "audit.command.blocked", severity: "warn" as const, message: "Blocked: rm -rf /" };
    const app2 = createApi(db, {
      activeProject: () => ({ projectId: "p1", root: "/r", name: "r", addedAt: 0 }),
      loadEvents: () => [e(1, "a") as never, e(3, "c") as never],
      loadCommandAuditEvents: () => [blockEvent],
    });
    const body = (await (await app2.request("/api/timeline")).json()) as { events: { type: string; ts: number }[] };
    expect(body.events.map((x) => x.type)).toEqual(["a", "audit.command.blocked", "c"]);
    expect(body.events[1].ts).toBe(2);
  });

  it("GET /api/knowledge/search returns semantic hits (L7.2)", async () => {
    const app2 = createApi(db, { search: (q) => [{ taskId: "t", projectHash: "h", eventType: "decision", text: `match ${q}`, score: 1 }] });
    const r = (await (await app2.request("/api/knowledge/search?q=axum")).json()) as { hits: { text: string }[] };
    expect(r.hits[0].text).toBe("match axum");
    expect(await (await app2.request("/api/knowledge/search")).json()).toEqual({ hits: [] });
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

  // ── worktree/branch cleanup at Done + leak-guard ──
  it("Done removes the task's worktree AND deletes its branch", async () => {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true }); // make isGitRepo(repo) true
    createTask(db, { id: "tw", title: "With repo", repo });
    const gitCalls: string[] = [];
    const app2 = createApi(db, { worktreeGit: (args) => { gitCalls.push(args.join(" ")); return ""; } });
    const done = await (await app2.request("/api/tasks/tw/done/run", { method: "POST" })).json();
    expect(done).toEqual({ ok: true });
    expect(gitCalls).toContainEqual(`branch -D ${worktreeBranch("tw")}`); // branch deleted
    expect(gitCalls.some((c) => c.startsWith("worktree remove --force"))).toBe(true); // worktree removed
    expect(gitCalls).toContain("worktree prune"); // stale admin records pruned
  });

  it("Done does not touch git for a non-git task", async () => {
    createTask(db, { id: "tn", title: "No repo" }); // no repo → no worktree
    const gitCalls: string[] = [];
    const app2 = createApi(db, { worktreeGit: (args) => { gitCalls.push(args.join(" ")); return ""; } });
    await app2.request("/api/tasks/tn/done/run", { method: "POST" });
    expect(gitCalls).toEqual([]);
  });

  it("leak-guard sweeps done/orphan worktrees, keeps active ones", () => {
    const prevBase = securityDataDir();
    configureSecurity({ dataDir: () => dir }); // worktree base → temp dir
    try {
      const repo = join(dir, "repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      const base = join(dir, "worktrees");
      // a done task with a leftover worktree → must be cleaned
      createTask(db, { id: "wt-done", title: "Done", repo });
      updateTaskStatus(db, "wt-done", "done");
      mkdirSync(join(base, "wt-done"), { recursive: true });
      // an active task → its worktree must be kept
      createTask(db, { id: "wt-live", title: "Live", repo });
      updateTaskStatus(db, "wt-live", "running");
      mkdirSync(join(base, "wt-live"), { recursive: true });
      // an orphan worktree (no task row) → repo resolved from its .git pointer
      mkdirSync(join(base, "wt-orphan"), { recursive: true });
      writeFileSync(join(base, "wt-orphan", ".git"), `gitdir: ${repo}/.git/worktrees/wt-orphan\n`);

      const gitCalls: string[] = [];
      const app2 = createApi(db, { worktreeGit: (args) => { gitCalls.push(args.join(" ")); return ""; } });
      (app2 as unknown as { sweepLeakedWorktrees: () => void }).sweepLeakedWorktrees();

      expect(gitCalls).toContainEqual(`branch -D ${worktreeBranch("wt-done")}`); // done → cleaned
      expect(gitCalls).toContainEqual(`branch -D ${worktreeBranch("wt-orphan")}`); // orphan → cleaned
      expect(gitCalls).not.toContainEqual(`branch -D ${worktreeBranch("wt-live")}`); // active → kept
    } finally {
      configureSecurity({ dataDir: () => prevBase }); // restore base for other tests
    }
  });

  it("DELETE task reclaims its worktree + branch inline", async () => {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    createTask(db, { id: "td", title: "Del", repo });
    const gitCalls: string[] = [];
    const app2 = createApi(db, { worktreeGit: (args) => { gitCalls.push(args.join(" ")); return ""; } });
    await app2.request("/api/tasks/td", { method: "DELETE" });
    expect(gitCalls).toContainEqual(`branch -D ${worktreeBranch("td")}`);
    expect(getTask(db, "td")).toBeUndefined(); // row gone too
  });

  it("Done keeps a worktree with uncommitted changes (no force-discard)", async () => {
    const prevBase = securityDataDir();
    configureSecurity({ dataDir: () => dir });
    try {
      const repo = join(dir, "repo");
      mkdirSync(join(repo, ".git"), { recursive: true });
      mkdirSync(join(dir, "worktrees", "tdirty"), { recursive: true }); // its worktree exists
      createTask(db, { id: "tdirty", title: "Dirty", repo });
      const gitCalls: string[] = [];
      // status returns changes → dirty → cleanup must bail before removing anything
      const app2 = createApi(db, {
        worktreeGit: (args) => { gitCalls.push(args.join(" ")); return args[0] === "status" ? " M file.ts\n" : ""; },
      });
      await app2.request("/api/tasks/tdirty/done/run", { method: "POST" });
      expect(gitCalls).toContainEqual("status --porcelain"); // checked
      expect(gitCalls.some((c) => c.startsWith("worktree remove"))).toBe(false); // not removed
      expect(gitCalls).not.toContainEqual(`branch -D ${worktreeBranch("tdirty")}`); // branch kept
    } finally {
      configureSecurity({ dataDir: () => prevBase });
    }
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

  it("MCP test uses a real probe by default (no deps) — reachable command passes, missing fails (loom-ivvi)", async () => {
    const a = createApi(db); // NO deps → must still wire a working probe, not "no probe configured"
    await a.request("/api/connectors/mcp", { method: "POST", body: JSON.stringify({ id: "probe-ok", command: "true" }) });
    expect(await (await a.request("/api/connectors/mcp/probe-ok/test", { method: "POST" })).json()).toMatchObject({ ok: true });
    await a.request("/api/connectors/mcp/probe-ok/remove", { method: "POST" });

    await a.request("/api/connectors/mcp", { method: "POST", body: JSON.stringify({ id: "probe-bad", command: "definitely-not-a-real-binary-xyz" }) });
    expect(await (await a.request("/api/connectors/mcp/probe-bad/test", { method: "POST" })).json()).toMatchObject({ ok: false });
    await a.request("/api/connectors/mcp/probe-bad/remove", { method: "POST" });
  });

  it("POST /api/connectors/import creates tasks from drafts (D5.4)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "Imported A" }, { title: "Imported B", description: "d" }] });
    const r = (await (await app2.request("/api/connectors/import", { method: "POST" })).json()) as { created: number };
    expect(r.created).toBe(2);
  });

  it("POST /api/connectors/import is idempotent by externalId (no duplicates)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "Issue 1", externalId: "bd-1" }, { title: "Issue 2", externalId: "bd-2" }] });
    const r1 = (await (await app2.request("/api/connectors/import", { method: "POST" })).json()) as { created: number; skipped: number };
    expect(r1).toMatchObject({ created: 2, skipped: 0 });
    const r2 = (await (await app2.request("/api/connectors/import", { method: "POST" })).json()) as { created: number; skipped: number };
    expect(r2).toMatchObject({ created: 0, skipped: 2 });
  });

  it("POST /api/connectors/import treats an empty externalId as no ref (not deduped)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "No id", externalId: "" }] });
    const a = (await (await app2.request("/api/connectors/import", { method: "POST" })).json()) as { created: number; skipped: number };
    const b = (await (await app2.request("/api/connectors/import", { method: "POST" })).json()) as { created: number; skipped: number };
    expect(a).toMatchObject({ created: 1, skipped: 0 });
    expect(b).toMatchObject({ created: 1, skipped: 0 });
  });

  it("GET /api/connectors lists the registry (D5.5)", async () => {
    const app2 = createApi(db);
    const r = (await (await app2.request("/api/connectors")).json()) as { connectors: { id: string; needsRepo: boolean }[] };
    const ids = r.connectors.map((m) => m.id);
    expect(ids).toContain("beads");
    expect(ids).toContain("github");
    expect(r.connectors.find((m) => m.id === "github")?.needsRepo).toBe(true);
  });

  // ── connectors: Claude plugins ──
  it("GET /api/connectors/plugins parses `claude plugin list` (name/version/status/bundled)", async () => {
    const app2 = createApi(db, {
      claudePlugin: () =>
        Promise.resolve({
          code: 0,
          stdout:
            "Installed plugins:\n\n" +
            "  ❯ my-plugin@my-marketplace\n    Version: 1.2.0\n    Scope: user\n    Status: ✔ enabled\n\n" +
            "  ❯ other@other-mkt\n    Version: 2.0.0\n    Scope: project\n    Status: ✘ disabled\n\n" +
            "  ❯ token-pilot@token-pilot\n    Version: 0.46.0\n    Scope: user\n    Status: ✔ enabled\n\n" +
            "  ❯ broken@mkt\n    Version: unknown\n    Scope: user\n    Status: error: not loaded\n",
        }),
    });
    const r = (await (await app2.request("/api/connectors/plugins")).json()) as {
      plugins: { name: string; version?: string; enabled: boolean; bundled?: boolean }[];
    };
    expect(r.plugins).toEqual([
      { name: "my-plugin@my-marketplace", version: "1.2.0", enabled: true, bundled: false },
      { name: "other@other-mkt", version: "2.0.0", enabled: false, bundled: false },
      { name: "token-pilot@token-pilot", version: "0.46.0", enabled: true, bundled: true }, // Loom-required
      { name: "broken@mkt", version: "unknown", enabled: false, bundled: false }, // odd status → NOT enabled (no false "on")
    ]);
  });

  it("blocks uninstall/disable of a bundled plugin (409), but allows update", async () => {
    const calls: string[][] = [];
    const app2 = createApi(db, { claudePlugin: (a) => { calls.push(a); return Promise.resolve({ code: 0, stdout: "" }); } });
    for (const verb of ["uninstall", "disable"]) {
      const res = await app2.request(`/api/connectors/plugins/token-pilot@token-pilot/${verb}`, { method: "POST" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ ok: false });
    }
    expect(calls).toEqual([]); // CLI never invoked for a blocked bundled op
    // update is still allowed (keeps bundled plugins current)
    const upd = await app2.request("/api/connectors/plugins/token-pilot@token-pilot/update", { method: "POST" });
    expect(upd.status).toBe(200);
    expect(calls).toContainEqual(["plugin", "update", "--", "token-pilot@token-pilot"]);
  });

  it("POST /api/connectors/plugins installs name@marketplace via the CLI", async () => {
    const calls: string[][] = [];
    const app2 = createApi(db, { claudePlugin: (a) => { calls.push(a); return Promise.resolve({ code: 0, stdout: "" }); } });
    const res = await app2.request("/api/connectors/plugins", { method: "POST", body: JSON.stringify({ name: "foo@bar" }) });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(calls).toContainEqual(["plugin", "install", "--", "foo@bar"]);
  });

  it("update/uninstall/enable/disable call `claude plugin <verb> -- <name>`", async () => {
    const calls: string[][] = [];
    const app2 = createApi(db, { claudePlugin: (a) => { calls.push(a); return Promise.resolve({ code: 0, stdout: "" }); } });
    for (const verb of ["update", "uninstall", "enable", "disable"]) {
      await app2.request(`/api/connectors/plugins/p/${verb}`, { method: "POST" });
    }
    expect(calls).toEqual([
      ["plugin", "update", "--", "p"],
      ["plugin", "uninstall", "--", "p"],
      ["plugin", "enable", "--", "p"],
      ["plugin", "disable", "--", "p"],
    ]);
  });

  it("rejects a flag-shaped plugin name without calling the CLI (400)", async () => {
    const calls: string[][] = [];
    const app2 = createApi(db, { claudePlugin: (a) => { calls.push(a); return Promise.resolve({ code: 0, stdout: "" }); } });
    const res = await app2.request("/api/connectors/plugins", { method: "POST", body: JSON.stringify({ name: "-rf" }) });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("POST /api/connectors/marketplaces adds a valid source; rejects an invalid one (400)", async () => {
    const calls: string[][] = [];
    const app2 = createApi(db, { claudePlugin: (a) => { calls.push(a); return Promise.resolve({ code: 0, stdout: "" }); } });
    const ok = await app2.request("/api/connectors/marketplaces", { method: "POST", body: JSON.stringify({ source: "octo/repo" }) });
    expect(await ok.json()).toMatchObject({ ok: true });
    expect(calls).toContainEqual(["plugin", "marketplace", "add", "--", "octo/repo"]);
    const bad = await app2.request("/api/connectors/marketplaces", { method: "POST", body: JSON.stringify({ source: "--evil" }) });
    expect(bad.status).toBe(400);
    expect(calls).toHaveLength(1); // CLI not called for the invalid source
  });

  it("GET /api/connectors/marketplaces parses the list", async () => {
    const app2 = createApi(db, { claudePlugin: () => Promise.resolve({ code: 0, stdout: "acme/store\nother/market\n" }) });
    const r = (await (await app2.request("/api/connectors/marketplaces")).json()) as { marketplaces: string[] };
    expect(r.marketplaces).toEqual(["acme/store", "other/market"]);
  });

  it("maps a failing CLI call to { ok:false, error } without throwing", async () => {
    const app2 = createApi(db, { claudePlugin: () => Promise.resolve({ code: 1, stdout: "boom" }) });
    const res = await app2.request("/api/connectors/plugins", { method: "POST", body: JSON.stringify({ name: "foo@bar" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, error: "boom" });
  });

  it("plugin/marketplace list parsers skip header & prose lines (no phantom rows)", async () => {
    const appP = createApi(db, {
      claudePlugin: () => Promise.resolve({ code: 0, stdout: "NAME VERSION ENABLED\nNo plugins installed" }),
    });
    const p = (await (await appP.request("/api/connectors/plugins")).json()) as { plugins: unknown[] };
    expect(p.plugins).toEqual([]);
    const appM = createApi(db, {
      claudePlugin: () => Promise.resolve({ code: 1, stdout: "No marketplaces configured\nclaude: command not found" }),
    });
    const m = (await (await appM.request("/api/connectors/marketplaces")).json()) as { marketplaces: unknown[] };
    expect(m.marketplaces).toEqual([]);
  });

  it("POST /api/connectors/import passes connector + repo to importDrafts (D5.5)", async () => {
    let seen: { connector?: string; repo?: string } | undefined;
    const app2 = createApi(db, {
      importDrafts: (opts) => { seen = opts; return [{ title: "Issue", externalId: "github:o/r#1" }]; },
    });
    const r = (await (await app2.request("/api/connectors/import", { method: "POST", body: JSON.stringify({ connector: "github", repo: "o/r" }) })).json()) as { created: number };
    expect(seen).toMatchObject({ connector: "github", repo: "o/r" });
    expect(r.created).toBe(1);
  });

  it("POST /api/connectors/import rejects github without a repo (D5.5)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "x" }] });
    const res = await app2.request("/api/connectors/import", { method: "POST", body: JSON.stringify({ connector: "github" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "repo required" });
  });

  it("POST /api/connectors/import rejects a whitespace-only github repo (D5.5)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "x" }] });
    const res = await app2.request("/api/connectors/import", { method: "POST", body: JSON.stringify({ connector: "github", repo: "   " }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "repo required" });
  });

  it("POST /api/connectors/import rejects an unknown connector id (D5.5)", async () => {
    const app2 = createApi(db, { importDrafts: () => [{ title: "x" }] });
    const res = await app2.request("/api/connectors/import", { method: "POST", body: JSON.stringify({ connector: "nope" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown connector" });
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
  it("GET /api/layers lists the full architecture: standalone + inline (L11)", async () => {
    const app2 = createApi(db);
    const body = (await (await app2.request("/api/layers")).json()) as { layers: { id: string; status: string }[] };
    // 3 standalone plugins (own package + repo); the rest — including the folded-in
    // security/quality/swarm layers — are inline modules of loom-host.
    expect(body.layers.filter((l) => l.status === "standalone").map((l) => l.id).sort()).toEqual(["accounts", "efficiency", "memory"]);
    expect(body.layers.some((l) => l.id === "automation" && l.status === "inline")).toBe(true);
    for (const id of ["security", "quality", "swarm"]) {
      expect(body.layers.some((l) => l.id === id && l.status === "inline")).toBe(true);
    }
    expect(body.layers.length).toBeGreaterThan(3);
  });
  it("GET /api/skills lists the skills library (L11)", async () => {
    const app2 = createApi(db);
    const body = (await (await app2.request("/api/skills")).json()) as { skills: unknown[] };
    expect(Array.isArray(body.skills)).toBe(true);
  });

  it("flow-config: POST persists the QA checks, GET reads them back (L6)", async () => {
    const app2 = createApi(db);
    await app2.request("/api/flow-config/qa", { method: "POST", body: JSON.stringify({ passes: ["tests"] }) });
    const got = (await (await app2.request("/api/flow-config/qa")).json()) as { passes: string[] };
    expect(got.passes).toEqual(["tests"]);
    expect((await app2.request("/api/flow-config/qa", { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("POST /api/skills/generate requires a description; 422 on invalid agent output", async () => {
    // agent returns text with no valid frontmatter name → nothing written, 422.
    const app2 = createApi(db, { skillAgent: async () => "no frontmatter" });
    expect((await app2.request("/api/skills/generate", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await app2.request("/api/skills/generate", { method: "POST", body: JSON.stringify({ description: "do x" }) })).status).toBe(422);
  });

  // ── quality (L6) ──
  it("GET /api/flow-config/:stage returns the resolved passes (L6)", async () => {
    const app2 = createApi(db);
    // review resolves the host reviewer catalog (self/ralph/adversarial), not the
    // package's generic passes; qa still resolves via the package default.
    expect(await (await app2.request("/api/flow-config/review")).json()).toEqual({ passes: ["self", "ralph", "adversarial"] });
    expect(await (await app2.request("/api/flow-config/qa")).json()).toEqual({ passes: ["tests", "build"] });
  });

  it("flow-config review: persists reviewer subset/order; empty → default (L6)", async () => {
    const app2 = createApi(db);
    await app2.request("/api/flow-config/review", { method: "POST", body: JSON.stringify({ passes: ["adversarial", "self"] }) });
    expect(await (await app2.request("/api/flow-config/review")).json()).toEqual({ passes: ["adversarial", "self"] });
    // disabling all reviewers falls back to the full default order (symmetric with QA)
    await app2.request("/api/flow-config/review", { method: "POST", body: JSON.stringify({ passes: [] }) });
    expect(await (await app2.request("/api/flow-config/review")).json()).toEqual({ passes: ["self", "ralph", "adversarial"] });
  });

  it("POST /review/run honors the persisted reviewer subset and order (L6)", async () => {
    const app2 = createApi(db, { reviewPass: (key) => ({ key, run: async () => [] }) });
    // Only "adversarial" enabled → it is the first (and only) reviewer; next is null.
    await app2.request("/api/flow-config/review", { method: "POST", body: JSON.stringify({ passes: ["adversarial"] }) });
    const r = (await (await app2.request("/api/tasks/t1/review/run", { method: "POST", body: "{}" })).json()) as { ran: string; next: string | null; reviewersDone: string[] };
    expect(r.ran).toBe("adversarial");
    expect(r.next).toBeNull();
    expect(r.reviewersDone).toEqual(["adversarial"]);
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

  // ── review depth scales with task class (loom-ohky) ──
  it("reviewersForClass narrows to one reviewer only for a chore", () => {
    const full = ["self", "ralph", "adversarial"];
    expect(reviewersForClass(full, "chore")).toEqual(["self"]); // trivial → single pass
    expect(reviewersForClass(full, "feature")).toEqual(full); // feature → full panel
    expect(reviewersForClass(full, "bug")).toEqual(full); // bug → full panel
    expect(reviewersForClass(full, "")).toEqual(full); // unknown → full (never under-reviews)
    expect(reviewersForClass(full, undefined)).toEqual(full);
    expect(reviewersForClass(["self"], "chore")).toEqual(["self"]); // already one → unchanged
  });
  it("analysis persists the task class so review can scale to it (loom-ohky)", async () => {
    const app2 = createApi(db, { stageAgent: async () => '{ "class": "chore", "route": ["analysis","impl","review","qa","pr","done"] }' });
    await app2.request("/api/tasks/t1/analysis/run", { method: "POST" });
    const settings = (await (await app2.request("/api/settings")).json()) as Record<string, unknown>;
    expect(settings["analysis.class.t1"]).toBe("chore");
  });

  it("isFatalAgentError flags a whole-reply auth/API/dead-session error, not a long real output (loom-authfail)", () => {
    expect(isFatalAgentError("Failed to authenticate. API Error: 401 Invalid authentication credentials")).toBe(true);
    expect(isFatalAgentError("⚠ The agent process ended before replying. Re-run the stage.")).toBe(true);
    expect(isFatalAgentError("API Error: 503 Service Unavailable")).toBe(true);
    expect(isFatalAgentError("Not logged in · Please run /login")).toBe(true); // unauthenticated profile
    expect(isFatalAgentError("⏱ The agent did not respond within the time limit — the session was stopped. Re-run the stage or switch the subscription.")).toBe(true); // per-turn timeout: impl never ran → must park, not fake-Done
    expect(isFatalAgentError("API Error: 429 Too Many Requests")).toBe(false); // rate limit → existing auto-fallback, not park
    expect(isFatalAgentError("")).toBe(false); // empty handled elsewhere
    expect(isFatalAgentError("Done. ИТОГ: ГОТОВО — implemented the fix and tests pass.")).toBe(false); // real work
    expect(isFatalAgentError("x".repeat(450) + " invalid authentication")).toBe(false); // long real output, not a bare error
  });

  // ── dialog stages (L12) ──
  it("analysis/brainstorm/spec endpoints drive the dialog stages (L12.5)", async () => {
    let n = 0;
    const stageAgent = async (prompt: string) => {
      if (prompt.includes("Classify")) return '{"class":"feature","route":["analysis","spec","impl","done"]}';
      if (prompt.includes("Summarise")) return "BRIEF";
      if (prompt.includes("SDD")) return "# SDD";
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

  it("DELETE /api/tasks/:id removes the task", async () => {
    const res = await app.request("/api/tasks/t1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const list = (await json("/api/tasks")).body;
    expect(list.tasks.some((t: { id: string }) => t.id === "t1")).toBe(false);
  });

  it("DELETE /api/tasks/:id 404 for missing", async () => {
    expect((await app.request("/api/tasks/zzz", { method: "DELETE" })).status).toBe(404);
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

  it("new task inherits the global default run_mode when none is given (loom-wkhe)", async () => {
    setSetting(db, "run_mode", "autopilot");
    const res = await app.request("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Inherits" }) });
    const { task } = (await res.json()) as { task: { run_mode: string } };
    expect(task.run_mode).toBe("autopilot"); // not the hardcoded "gated"
  });

  it("GET /api/tasks/:id/dossier weaves stages, cost and artifacts into the history", async () => {
    upsertCost(db, "t1", "claude", "tokens", 1200, true);
    addAttachment(db, { id: "att1", taskId: "t1", kind: "file", name: "plan.md", pathOrUrl: "/repo/plan.md" });
    const { status, body } = await json("/api/tasks/t1/dossier");
    expect(status).toBe(200);
    expect(body.pack).toContain("## Stages"); // task was started → has stage rows
    expect(body.pack).toContain("## Cost");
    expect(body.pack).toContain("1200");
    expect(body.pack).toContain("## Artifacts");
    expect(body.pack).toContain("plan.md");
  });

  it("POST gate toggles the stage gate", async () => {
    await post("/api/tasks", { id: "m2", title: "M2" });
    await post("/api/tasks/m2/stages/spec/gate", { gate: false });
    const detail = (await json("/api/tasks/m2")).body;
    expect(detail.stages.find((s: { stage_key: string }) => s.stage_key === "spec").gate).toBe(0);
  });

  it("gate/accept on an unknown stage → 400, not a silent no-op (loom-1c75)", async () => {
    await post("/api/tasks", { id: "uk", title: "UK" });
    expect((await post("/api/tasks/uk/stages/nope/gate", { gate: true })).status).toBe(400);
    expect((await post("/api/tasks/uk/stages/nope/accept")).status).toBe(400);
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
    // a path INSIDE the tree that just doesn't exist (e.g. an unbuilt artifact
    // like dist/cli.js) → 404 not-found, NOT a misleading 403 "outside the task"
    const missing = await a.request("/api/tasks/fr/file?path=dist/cli.js");
    expect(missing.status).toBe(404);
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

  it("autopilot review skips the expensive auto-fix and parks when over the cost cap (loom-wqzr)", async () => {
    createTask(database, { id: "rcap", title: "RCAP", run_mode: "autopilot" });
    upsertCost(database, "rcap", "aimux", "spent", 7, true); // already over the $6 default auto-fix cap
    const rm = createRunManager();
    let fixCalls = 0;
    const a = createApi(database, {
      runManager: rm,
      stageAgent: async () => { fixCalls++; return "исправил\nИТОГ: ГОТОВО"; }, // only the auto-fix path uses stageAgent
      reviewPass: (key) => ({ key, run: async () => [{ pass: key, severity: "bug" as const, message: "boom" }] }),
    });
    await a.request("/api/tasks/rcap/start", { method: "POST" });
    await a.request("/api/tasks/rcap/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "review" }) });
    const { runId } = (await (await a.request("/api/tasks/rcap/stages/review/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    expect(fixCalls).toBe(0); // auto-fix NOT run — cost cap hit, so no extra opus spend
    const stages = (await (await a.request("/api/tasks/rcap")).json()) as { stages: { stage_key: string; status: string }[] };
    expect(stages.stages.find((s) => s.stage_key === "review")!.status).toBe("active"); // parked for a manual fix
    expect((await transcriptOf(a, "rcap")).some((t) => /auto-fix cap|parking for a manual fix/i.test(t.output))).toBe(true);
  });

  it("review fix with no findings → 400", async () => {
    createTask(database, { id: "rf0", title: "RF0" });
    const a = createApi(database);
    expect((await a.request("/api/tasks/rf0/review/fix", { method: "POST" })).status).toBe(400);
  });

  it("parks the stage (degraded, NOT done) when the agent returns a fatal auth error (loom-authfail)", async () => {
    createTask(database, { id: "af", title: "AF", run_mode: "manual" });
    const rm = createRunManager();
    const a = createApi(database, { runManager: rm, stageAgent: async () => "Failed to authenticate. API Error: 401 Invalid authentication credentials" });
    await a.request("/api/tasks/af/start", { method: "POST" });
    const { runId } = (await (await a.request("/api/tasks/af/stages/analysis/run", { method: "POST", body: "{}" })).json()) as { runId: string };
    await rm.wait(runId);
    const detail = (await (await a.request("/api/tasks/af")).json()) as { stages: { stage_key: string; status: string }[]; degraded: string[] };
    expect(detail.stages.find((s) => s.stage_key === "analysis")!.status).not.toBe("done"); // not fake-completed
    expect(detail.degraded.some((d) => /agent error/i.test(d))).toBe(true); // surfaced, not silent
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

  it("autopilot parks at pr when no PR was opened, instead of marking done (loom-sd0k)", async () => {
    createTask(database, { id: "prk", title: "PRpark", route: ["pr", "done"], run_mode: "autopilot" });
    startTask(database, "prk");
    const a = createApi(database); // no connector → description-only, pr.created=false
    const res = (await (await a.request("/api/tasks/prk/run-stage", { method: "POST", body: "{}" })).json()) as { stoppedAt: string | null };
    expect(res.stoppedAt).toBe("pr"); // parked for the human to open the (irreversible) PR
    expect(getTask(database, "prk")?.status).not.toBe("done");
  });

  it("autopilot parks at pr when the PR push fails, not silently done (loom-ae6s)", async () => {
    createTask(database, { id: "prf", title: "PRfail", repo: "/tmp/x", route: ["pr", "done"], run_mode: "autopilot" });
    startTask(database, "prf");
    // connector path with a failing git → pr.created=false + pr.error set
    const a = createApi(database, {
      prOptions: () => ({ connector: true, repoRoot: "/tmp/x", branch: "loom/prf", sh: async (cmd: string) => ({ code: cmd === "gh" ? 0 : 1, stdout: "boom" }) }),
    });
    const res = (await (await a.request("/api/tasks/prf/run-stage", { method: "POST", body: "{}" })).json()) as { stoppedAt: string | null };
    expect(res.stoppedAt).toBe("pr"); // a failed PR must not count as done
    expect(getTask(database, "prf")?.status).not.toBe("done");
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

  it("stop halts the task's running run and kills the live session", async () => {
    createTask(database, { id: "sp", title: "Stop" });
    const stopped: string[] = [];
    const launcherStopped: string[] = [];
    const rm = {
      list: () => [{ runId: "run_x", taskId: "sp", status: "running" }],
      stop: (runId: string) => { stopped.push(runId); return true; },
    } as unknown as ReturnType<typeof createRunManager>;
    const sessionLauncher = { run: async () => ({ text: "" }), stop: (s: string) => { launcherStopped.push(s); }, denialsOf: () => [] };
    const a = createApi(database, { runManager: rm, sessionLauncher });
    const res = await a.request("/api/tasks/sp/stop", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(stopped).toEqual(["run_x"]); // RunManager.stop called with the running run
    expect(launcherStopped.length).toBe(1); // live session process killed
  });

  it("stop returns 404 for an unknown task", async () => {
    const a = createApi(database);
    const res = await a.request("/api/tasks/nope/stop", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("stop is idempotent when there is no active run", async () => {
    createTask(database, { id: "si", title: "Idem" });
    const stopped: string[] = [];
    const rm = {
      list: () => [],
      stop: (runId: string) => { stopped.push(runId); return true; },
    } as unknown as ReturnType<typeof createRunManager>;
    const a = createApi(database, { runManager: rm });
    const res = await a.request("/api/tasks/si/stop", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(stopped).toEqual([]); // nothing running → RunManager.stop not called
  });

  it("reconcileInterruptedRuns marks stale running rows interrupted on boot", () => {
    createTask(database, { id: "rc", title: "Recon" });
    insertRun(database, { id: "run_stale", taskId: "rc" }); // left 'running' by a dead process
    expect(reconcileInterruptedRuns(database)).toBeGreaterThanOrEqual(1);
    expect(listRunsForTask(database, "rc")[0].status).toBe("interrupted");
  });

  it("attentionQueue surfaces a task crashed mid-run, not just gated ones (loom-oldr)", () => {
    createTask(database, { id: "crash1", title: "Crashed", route: ["impl", "done"], run_mode: "autopilot" });
    startTask(database, "crash1"); // impl active, gate 0 (autopilot ignores gates)
    insertRun(database, { id: "run_c", taskId: "crash1" }); // running, then the process dies
    reconcileInterruptedRuns(database); // boot reconcile → interrupted
    expect(attentionQueue(database).some((i) => i.taskId === "crash1")).toBe(true);
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

  it("scans agent output for secrets and audits them on the normal run path (loom-l6z1)", async () => {
    const prevXdg = process.env.XDG_DATA_HOME;
    const xdg = mkdtempSync(join(tmpdir(), "loom-sec-"));
    process.env.XDG_DATA_HOME = xdg;
    try {
      const { configureSecurity } = await import("../../src/core/security/config.js");
      const { appendLoomEvent, loadLoomEvents } = await import("../../src/core/spine/event-bus.js");
      configureSecurity({ emit: (pid, ev) => appendLoomEvent(pid, ev as never) }); // mirror server.ts wiring
      createTask(database, { id: "sec1", title: "Sec", run_mode: "manual" });
      const sessionLauncher = { run: async () => ({ text: `leaked sk-ant-${"a".repeat(24)}` }), denialsOf: () => [] };
      const rm = createRunManager();
      const a = createApi(database, { sessionLauncher, runManager: rm });
      await a.request("/api/tasks/sec1/start", { method: "POST" });
      await a.request("/api/tasks/sec1/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "rd" }) });
      const { runId } = (await (await a.request("/api/tasks/sec1/stages/rd/run", { method: "POST", body: "{}" })).json()) as { runId: string };
      await rm.wait(runId);
      expect(loadLoomEvents("default").some((e) => e.type === "audit.secret.found")).toBe(true);
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prevXdg;
      rmSync(xdg, { recursive: true, force: true });
    }
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
    expect(seenPrompt).not.toContain("Stage:");
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
    // Loom-bundled MCP servers the agent is told to use must be allowed by default
    // in gated/manual — both the plugin-delivered and standalone-server names (loom-hlpy).
    expect(seenAllowed).toContain("mcp__plugin_token-pilot_token-pilot");
    expect(seenAllowed).toContain("mcp__token-pilot");
    expect(seenAllowed).toContain("mcp__plugin_task-journal_task-journal");
    expect(seenAllowed).toContain("mcp__task-journal");
    expect(seenAllowed).not.toContain("Bash"); // unrestricted Bash is NOT default-allowed

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

  it("drains launcher spawn-time degradations onto the task after a send (deduped)", async () => {
    createTask(database, { id: "dg1", title: "Degraded" });
    const sessionLauncher = {
      run: async () => ({ text: '{"class":"feature","route":["analysis"]}' }),
      denialsOf: () => [],
      degradedOf: () => ["MCP servers not loaded (config write failed)"],
    };
    const a = createApi(database, { sessionLauncher });
    await a.request("/api/tasks/dg1/analysis/run", { method: "POST", body: "{}" });
    await a.request("/api/tasks/dg1/analysis/run", { method: "POST", body: "{}" }); // twice → must not pile up
    const detail = (await (await a.request("/api/tasks/dg1")).json()) as { degraded: string[] };
    expect(detail.degraded).toEqual(["MCP servers not loaded (config write failed)"]);
  });

  it("records a degraded marker instead of crashing when reading cost/denials throws", async () => {
    createTask(database, { id: "dg2", title: "Degraded2" });
    const sessionLauncher = {
      run: async () => ({ text: '{"class":"feature","route":["analysis"]}' }),
      costOf: () => { throw new Error("boom"); },
      denialsOf: () => { throw new Error("boom"); },
    };
    const a = createApi(database, { sessionLauncher });
    const res = await a.request("/api/tasks/dg2/analysis/run", { method: "POST", body: "{}" });
    expect(res.status).toBe(200); // defensive: the send path never throws
    const detail = (await (await a.request("/api/tasks/dg2")).json()) as { degraded: string[] };
    expect(detail.degraded).toContain("session cost not recorded");
    expect(detail.degraded).toContain("permission denials not recorded");
  });

  it("GET /api/tasks/:id/dossier shows a Degraded section when the task degraded", async () => {
    createTask(database, { id: "dg3", title: "Degraded3" });
    createArtifact(database, { id: "art_dg", taskId: "dg3", stage: "system", kind: "degraded", content: JSON.stringify({ reasons: ["journal snapshot failed"] }), status: "accepted" });
    const a = createApi(database);
    const body = (await (await a.request("/api/tasks/dg3/dossier")).json()) as { pack: string };
    expect(body.pack).toContain("## ⚠ Degraded");
    expect(body.pack).toContain("journal snapshot failed");
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

  it("POST /api/tasks/:id/pr/run with connector pushes the branch and returns a host PR link (no gh)", async () => {
    createTask(database, { id: "p1", title: "Ship it", repo: "/repo", branch: "main" });
    const calls: Array<[string, string[]]> = [];
    const sh = async (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      if (cmd === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:x/y.git\n" };
      if (cmd === "git" && args[0] === "symbolic-ref") return { code: 0, stdout: "origin/master\n" };
      return { code: 0, stdout: "" };
    };
    const a = createApi(database, { prOptions: () => ({ sh }) });
    const res = await a.request("/api/tasks/p1/pr/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connector: true }),
    });
    const body = (await res.json()) as { pr: { created: boolean; pushed?: boolean; compareUrl?: string } };
    expect(body.pr.pushed).toBe(true);
    expect(body.pr.created).toBe(false); // we never auto-create — the user opens the PR
    expect(body.pr.compareUrl).toBe("https://github.com/x/y/compare/master...loom/p1?expand=1");
    expect(calls.some((c) => c[0] === "git" && c[1][0] === "push" && c[1].includes("loom/p1"))).toBe(true);
    expect(calls.some((c) => c[0] === "gh")).toBe(false); // host-agnostic — no gh
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

  it("pushing the branch does NOT finalize — the task stays parked at pr for the user to open the PR", async () => {
    createTask(database, { id: "prd", title: "PR Done", repo: "/repo", branch: "main" });
    const sh = async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "remote") return { code: 0, stdout: "git@github.com:x/y.git\n" };
      return { code: 0, stdout: "" };
    };
    const a = createApi(database, { prOptions: () => ({ sh }) });
    await a.request("/api/tasks/prd/start", { method: "POST" });
    await a.request("/api/tasks/prd/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stageKey: "pr" }) });
    const res = (await (await a.request("/api/tasks/prd/pr/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connector: true }) })).json()) as { pr: { pushed?: boolean }; done: boolean };
    expect(res.pr.pushed).toBe(true);
    expect(res.done).toBeFalsy(); // pushing isn't merging — Loom can't know when the PR lands
    const t = (await (await a.request("/api/tasks/prd")).json()) as { task: { status: string }; stages: { stage_key: string; status: string }[] };
    expect(t.task.status).not.toBe("done"); // parked, not finalized
    expect(t.stages.find((s) => s.stage_key === "pr")!.status).toBe("active");
  });
});
