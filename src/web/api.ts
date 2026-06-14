// Local HTTP API over the core store — the backend the React web-UI (and the
// Tauri sidecar) talk to. Read endpoints first; mutations land in later slices.
// The db is injected so the API is testable with a seeded in-memory store.

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { listTasks, getTask, getStages, createTask, setStageGate } from "../core/store/db.js";
import { getSteps } from "../core/store/steps.js";
import { getCosts } from "../core/store/execute.js";
import { boardColumns, attentionQueue, startTask, completeStage } from "../core/pipeline/engine.js";
import { loadWorkspaceData, type WorkspaceData } from "../core/data/loader.js";
import { resolveProjectRoot } from "../core/workspace/project-id.js";
import { taskDetail } from "../core/plugins/task-journal/adapter.js";
import { saveActiveProfile } from "@digital-threads/aimux/core";
import {
  listProjects,
  addProject,
  activeProject,
  setActiveProject,
  type ProjectEntry,
} from "../core/workspace/projects.js";
import { streamSSE } from "hono/streaming";
import { createRunManager, type RunManager } from "../core/automation/run-manager.js";
import { startSpecRun } from "../core/automation/start-run.js";
import { buildSpineIds } from "../core/spine/ids.js";
import { loadLoomEvents } from "../core/spine/event-bus.js";
import type { LoomEvent } from "../core/spine/event.js";
import { boardTotals, agentPerformance, failureReasons } from "../core/observability/metrics.js";
import { recallPrior, partitionHits, type RecallHit } from "../core/knowledge/recall.js";
import {
  runAnalysis,
  brainstormTurn,
  summarizeBrainstorm,
  draftSpec,
  reviseSpec,
  acceptSpec,
  type StageAgent,
} from "../core/pipeline/stage-runners.js";
import { createAimuxStageAgent } from "../core/pipeline/stage-agent.js";
import { getChatMessages, latestArtifact } from "../core/store/artifacts.js";
import { runPr, runDone, type PrOptions } from "../core/pipeline/pr-done.js";
import { advanceTask, runAndAdvance, type RunnerRegistry, type StageOutcome } from "../core/pipeline/conductor.js";
import { loomRegistry } from "../core/plugins/index.js";
import { getAllSettings, setSetting } from "../core/store/settings.js";
import { addAttachment, getAttachments } from "../core/store/attachments.js";
import { listMcp, addMcp, toggleMcp, removeMcp, testMcp, type McpProbe } from "../core/connectors/mcp.js";
import { resolveFlow } from "../core/quality/flow-config.js";
import { runReview, reviewAction } from "../core/quality/review-runner.js";
import { runQa, type QaCheck } from "../core/quality/qa-runner.js";
import { reviewPrompt, parseFindings, type ReviewPass } from "../core/quality/review.js";

// Injected backends so the API is testable without touching real aimux/tj/fs.
export interface ApiDeps {
  loadWorkspace?: (root?: string) => Promise<WorkspaceData>;
  setActiveProfile?: (profileId: string) => void;
  memoryTask?: (id: string) => unknown;
  listProjects?: () => ProjectEntry[];
  addProject?: (root: string) => ProjectEntry;
  setActiveProject?: (id: string) => boolean;
  activeProject?: () => ProjectEntry | null;
  runManager?: RunManager;
  /** Start a run for a task stage; returns the runId. Override for tests. */
  startRun?: (taskId: string, stageKey: string) => string;
  /** Load the project's event stream (default: file bus). */
  loadEvents?: (projectId: string) => LoomEvent[];
  /** Recall prior reasoning for a query (default: task-journal recall --json). */
  recall?: (query: string) => RecallHit[];
  /** Agent for the dialog stages (default: aimux cheap one-shot). */
  stageAgent?: StageAgent;
  /** Build a review pass for a key/target (default: aimux agent + parseFindings). */
  reviewPass?: (key: string, target: string) => ReviewPass;
  /** Build QA checks for the resolved keys (default: none until configured). */
  qaChecks?: (keys: string[]) => QaCheck[];
  /** PR options for the PR stage (default: description-only, no connector). */
  prOptions?: (taskId: string) => PrOptions;
  /** Close the task in task-journal at Done (default: no-op). */
  closeTask?: (taskId: string) => void;
  /** Stage runner registry for the conductor (default: wired to L4/L6/L12/L14). */
  runners?: RunnerRegistry;
  /** Probe for MCP connector tests (default: none → test reports unconfigured). */
  mcpProbe?: McpProbe;
}

export function createApi(db: Database.Database, deps: ApiDeps = {}): Hono {
  const app = new Hono();
  const loadWorkspace = deps.loadWorkspace ?? loadWorkspaceData;
  const setActiveProfile = deps.setActiveProfile ?? saveActiveProfile;
  const memoryTask =
    deps.memoryTask ?? ((id: string) => taskDetail(resolveProjectRoot(process.cwd()), id));
  const projectsList = deps.listProjects ?? (() => listProjects());
  const projectAdd = deps.addProject ?? ((root: string) => addProject(root));
  const projectSetActive = deps.setActiveProject ?? ((id: string) => setActiveProject(id));
  const projectActive = deps.activeProject ?? (() => activeProject());
  const loadEvents = deps.loadEvents ?? ((projectId: string) => loadLoomEvents(projectId));
  const recall =
    deps.recall ?? ((query: string) => recallPrior(resolveProjectRoot(process.cwd()), query));
  const stageAgent = deps.stageAgent ?? createAimuxStageAgent();
  const taskSpec = (id: string) => {
    const t = getTask(db, id);
    return t?.description || t?.title || id;
  };
  const reviewPass =
    deps.reviewPass ??
    ((key: string, target: string): ReviewPass => ({
      key,
      run: async () => parseFindings(key, await stageAgent(reviewPrompt(key, target))),
    }));
  const qaChecks = deps.qaChecks ?? (() => [] as QaCheck[]);

  // L13 — default stage runners: wire each pipeline stage to its layer. Override
  // via deps.runners for tests. Interactive stages (brainstorm/spec) are driven
  // by the UI; the conductor auto-runs them best-effort here for autopilot.
  async function runImplStage(taskId: string): Promise<StageOutcome> {
    const t = getTask(db, taskId);
    const ids = buildSpineIds({ repoRoot: t?.repo || process.cwd(), taskId });
    const runId = startSpecRun(rm, db, taskId, taskSpec(taskId), ids);
    const rec = await rm.wait(runId);
    const result = rec.result as { exec?: { dag?: { ok?: boolean } } } | undefined;
    return { ok: rec.status === "done" && (result?.exec?.dag?.ok ?? true) };
  }
  const doneProjectId = () => projectActive()?.projectId ?? "default";
  const defaultRunners: RunnerRegistry = {
    analysis: async (_d, id) => { await runAnalysis(db, id, taskSpec(id), stageAgent); return { ok: true }; },
    brainstorm: async () => ({ ok: true }), // human-driven via StageDialog
    spec: async (_d, id) => { await draftSpec(db, id, stageAgent); acceptSpec(db, id); return { ok: true }; },
    rd: async (_d, id) => runImplStage(id),
    impl: async (_d, id) => runImplStage(id),
    review: async (_d, id) => {
      const res = await runReview(resolveFlow("review"), (k) => reviewPass(k, taskSpec(id)));
      return { ok: res.passed, needsAttention: !res.passed };
    },
    qa: async () => {
      const res = await runQa(qaChecks(resolveFlow("qa")));
      return { ok: res.passed, needsAttention: !res.passed };
    },
    pr: async (_d, id) => { runPr(db, id, deps.prOptions?.(id) ?? {}); return { ok: true }; },
    done: async (_d, id) => { runDone(db, id, { projectId: doneProjectId(), closeTask: () => deps.closeTask?.(id) }); return { ok: true }; },
  };
  const runners = deps.runners ?? defaultRunners;
  const resolveProjectId = (c: { req: { query: (k: string) => string | undefined } }) =>
    c.req.query("project") ?? projectActive()?.projectId ?? "default";
  const rm = deps.runManager ?? createRunManager();
  const startRun =
    deps.startRun ??
    ((taskId: string) => {
      const task = getTask(db, taskId);
      const spec = task?.description || task?.title || taskId;
      const ids = buildSpineIds({ repoRoot: task?.repo || process.cwd(), taskId });
      return startSpecRun(rm, db, taskId, spec, ids);
    });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // The 3 core modules' aggregated workspace. ?project=<id> loads a specific
  // registered project; otherwise the active project (D3) / cwd.
  app.get("/api/workspace", async (c) => {
    const pid = c.req.query("project");
    const root = pid ? projectsList().find((p) => p.projectId === pid)?.root : undefined;
    return c.json(await loadWorkspace(root));
  });

  // ─── projects (D3) ─────────────────────────────────────────────────────────
  app.get("/api/projects", (c) =>
    c.json({ projects: projectsList(), active: projectActive()?.projectId ?? null }),
  );
  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown };
    const root = typeof body.root === "string" ? body.root.trim() : "";
    if (!root) return c.json({ error: "root required" }, 400);
    return c.json({ project: projectAdd(root) }, 201);
  });
  app.post("/api/projects/active", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: unknown };
    const id = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectSetActive(id)) return c.json({ error: "unknown project" }, 404);
    return c.json({ active: id });
  });

  // Board view-model: 9 stage columns with their cards.
  app.get("/api/board", (c) => c.json({ columns: boardColumns(db) }));

  // Attention queue: tasks parked at a gated stage.
  app.get("/api/attention", (c) => c.json({ items: attentionQueue(db) }));

  // All tasks (newest first).
  app.get("/api/tasks", (c) => c.json({ tasks: listTasks(db) }));

  // One task: identity + stages + steps + cost rollups.
  app.get("/api/tasks/:id", (c) => {
    const id = c.req.param("id");
    const task = getTask(db, id);
    if (!task) return c.json({ error: "not found" }, 404);
    return c.json({
      task,
      stages: getStages(db, id),
      steps: getSteps(db, id),
      costs: getCosts(db, id),
    });
  });

  // ─── mutations ──────────────────────────────────────────────────────────

  // Create a task (seeds its stage rows). Body: { title, repo?, branch?,
  // description?, run_mode?, route?, id? }.
  app.post("/api/tasks", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return c.json({ error: "title required" }, 400);
    const id = typeof body.id === "string" && body.id ? body.id : `t-${randomUUID().slice(0, 8)}`;
    const task = createTask(db, {
      id,
      title,
      repo: typeof body.repo === "string" ? body.repo : undefined,
      branch: typeof body.branch === "string" ? body.branch : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      run_mode: typeof body.run_mode === "string" ? body.run_mode : undefined,
      route: Array.isArray(body.route) ? (body.route as string[]) : undefined,
    });
    return c.json({ task }, 201);
  });

  // Start a task (activate its first stage).
  app.post("/api/tasks/:id/start", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const active = startTask(db, id);
    return c.json({ active });
  });

  // Accept a stage: complete it and advance. Returns the new active stage (or null).
  app.post("/api/tasks/:id/stages/:key/accept", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const next = completeStage(db, id, c.req.param("key"));
    return c.json({ next });
  });

  // Toggle a stage's gate. Body: { gate: boolean }.
  app.post("/api/tasks/:id/stages/:key/gate", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { gate?: unknown };
    setStageGate(db, id, c.req.param("key"), body.gate !== false);
    return c.json({ ok: true });
  });

  // ─── module actions (F1.5) ────────────────────────────────────────────────

  // Re-check account health (re-loads the workspace). Returns the health slice.
  app.post("/api/accounts/health", async (c) => {
    const ws = await loadWorkspace();
    return c.json({ health: ws.health });
  });

  // Swap the active aimux profile. Body: { profileId }.
  app.post("/api/accounts/active", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { profileId?: unknown };
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    if (!profileId) return c.json({ error: "profileId required" }, 400);
    setActiveProfile(profileId);
    return c.json({ active: profileId });
  });

  // task-journal task detail (decisions/findings/rejections) for the Memory drill-in.
  app.get("/api/memory/tasks/:id", (c) => c.json({ detail: memoryTask(c.req.param("id")) }));

  // ─── observability (L9) ──────────────────────────────────────────────────────
  // Unified timeline: the project's LoomEvent stream, time-ordered.
  app.get("/api/timeline", (c) => {
    const events = [...loadEvents(resolveProjectId(c))].sort((a, b) => a.ts - b.ts);
    return c.json({ events });
  });
  // Board-wide token totals (provenance shown per cost row on the task view).
  app.get("/api/metrics/board", (c) => c.json(boardTotals(loadEvents(resolveProjectId(c)))));
  // Agent performance + failure reasons (L9.3).
  app.get("/api/metrics/agents", (c) => {
    const events = loadEvents(resolveProjectId(c));
    return c.json({ agents: agentPerformance(events), failures: failureReasons(events) });
  });

  // ─── knowledge (L7) ──────────────────────────────────────────────────────────
  // Recall prior reasoning for a query → "already decided" vs "already rejected".
  app.get("/api/knowledge/recall", (c) => {
    const q = c.req.query("q") ?? "";
    const hits = q ? recall(q) : [];
    return c.json({ hits, ...partitionHits(hits) });
  });

  // ─── conductor (L13) ──────────────────────────────────────────────────────────
  // Drive the task per run_mode (manual parks, gated stops at gate=1, autopilot
  // runs through). run-stage runs the current stage (manual Run / gate approval).
  app.post("/api/tasks/:id/advance", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json(await advanceTask(db, id, runners));
  });
  app.post("/api/tasks/:id/run-stage", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json(await runAndAdvance(db, id, runners));
  });

  // ─── PR / Done (L14) ──────────────────────────────────────────────────────────
  app.post("/api/tasks/:id/pr/run", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json({ pr: runPr(db, id, deps.prOptions?.(id) ?? {}) });
  });
  app.post("/api/tasks/:id/done/run", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    runDone(db, id, { projectId: resolveProjectId(c), closeTask: () => deps.closeTask?.(id) });
    return c.json({ ok: true });
  });

  // ─── dialog stages (L12) ─────────────────────────────────────────────────────
  app.post("/api/tasks/:id/analysis/run", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json(await runAnalysis(db, id, taskSpec(id), stageAgent));
  });
  app.get("/api/tasks/:id/brainstorm/messages", (c) =>
    c.json({ messages: getChatMessages(db, c.req.param("id"), "brainstorm") }),
  );
  app.post("/api/tasks/:id/brainstorm/message", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message : undefined;
    return c.json({ question: await brainstormTurn(db, id, stageAgent, message) });
  });
  app.post("/api/tasks/:id/brainstorm/done", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json({ summary: await summarizeBrainstorm(db, id, stageAgent) });
  });
  app.get("/api/tasks/:id/spec", (c) =>
    c.json({ spec: latestArtifact(db, c.req.param("id"), "spec-md") ?? null }),
  );
  app.post("/api/tasks/:id/spec/draft", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json({ spec: await draftSpec(db, id, stageAgent) });
  });
  app.post("/api/tasks/:id/spec/return", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { comment?: unknown };
    const comment = typeof body.comment === "string" ? body.comment : "";
    return c.json({ spec: await reviseSpec(db, id, comment, stageAgent) });
  });
  app.post("/api/tasks/:id/spec/accept", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const spec = acceptSpec(db, id);
    return spec ? c.json({ spec }) : c.json({ error: "no spec" }, 404);
  });

  // ─── connectors: MCP (D5) ─────────────────────────────────────────────────────
  app.get("/api/connectors/mcp", (c) => c.json({ servers: listMcp() }));
  app.post("/api/connectors/mcp", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { id?: unknown; command?: unknown; args?: unknown };
    if (typeof b.id !== "string" || typeof b.command !== "string") return c.json({ error: "id and command required" }, 400);
    const args = Array.isArray(b.args) ? (b.args as string[]) : undefined;
    return c.json({ server: addMcp({ id: b.id, command: b.command, args }) }, 201);
  });
  app.post("/api/connectors/mcp/:id/toggle", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    const ok = toggleMcp(c.req.param("id"), b.enabled !== false);
    return ok ? c.json({ ok: true }) : c.json({ error: "unknown server" }, 404);
  });
  app.post("/api/connectors/mcp/:id/remove", (c) => { removeMcp(c.req.param("id")); return c.json({ ok: true }); });
  app.post("/api/connectors/mcp/:id/test", (c) => c.json(testMcp(c.req.param("id"), { probe: deps.mcpProbe })));

  // ─── settings / attachments (D6) ──────────────────────────────────────────────
  app.get("/api/settings", (c) => c.json(getAllSettings(db)));
  app.post("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
    if (typeof body.key !== "string") return c.json({ error: "key required" }, 400);
    setSetting(db, body.key, body.value);
    return c.json({ ok: true });
  });
  app.get("/api/tasks/:id/attachments", (c) => c.json({ attachments: getAttachments(db, c.req.param("id")) }));
  app.post("/api/tasks/:id/attachments", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as { kind?: unknown; name?: unknown; pathOrUrl?: unknown };
    const kind = b.kind === "link" ? "link" : "file";
    const name = typeof b.name === "string" ? b.name : "";
    const pathOrUrl = typeof b.pathOrUrl === "string" ? b.pathOrUrl : "";
    if (!name || !pathOrUrl) return c.json({ error: "name and pathOrUrl required" }, 400);
    return c.json({ attachment: addAttachment(db, { id: `att-${randomUUID().slice(0, 8)}`, taskId: id, kind, name, pathOrUrl }) }, 201);
  });

  // ─── extensibility: layers / skills (L11) ─────────────────────────────────────
  app.get("/api/layers", (c) =>
    c.json({
      layers: loomRegistry.list().map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category ?? null,
        executes: typeof p.execute === "function",
        slots: p.slots ?? [],
        capabilities: p.capabilities ?? null,
      })),
    }),
  );
  app.get("/api/skills", (c) =>
    c.json({
      slots: loomRegistry
        .list()
        .flatMap((p) => (p.slots ?? []).map((s) => ({ plugin: p.id, stage: s.stage, skill: s.skill }))),
    }),
  );

  // ─── quality: review / qa (L6) ────────────────────────────────────────────────
  app.get("/api/flow-config/:stage", (c) => c.json({ passes: resolveFlow(c.req.param("stage")) }));
  app.post("/api/tasks/:id/review/run", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown; passes?: unknown };
    const override = Array.isArray(body.passes) ? { passes: body.passes as string[] } : undefined;
    const keys = resolveFlow("review", undefined, override);
    const result = await runReview(keys, (key) => reviewPass(key, taskSpec(id)));
    const mode = body.mode === "autofix" ? "autofix" : "triage";
    return c.json({ result, action: reviewAction(result, mode) });
  });
  app.post("/api/tasks/:id/qa/run", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { checks?: unknown };
    const override = Array.isArray(body.checks) ? { passes: body.checks as string[] } : undefined;
    const keys = resolveFlow("qa", undefined, override);
    return c.json({ result: await runQa(qaChecks(keys)) });
  });

  // ─── runs (L4.4) ────────────────────────────────────────────────────────────

  // Start a stage run (async). Returns { runId } immediately; progress streams
  // via /api/runs/:runId/stream.
  app.post("/api/tasks/:id/stages/:key/run", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const runId = startRun(id, c.req.param("key"));
    return c.json({ runId });
  });

  // Run snapshot (fallback polling): status + events + output.
  app.get("/api/runs/:runId", (c) => {
    const rec = rm.get(c.req.param("runId"));
    if (!rec) return c.json({ error: "not found" }, 404);
    return c.json({ runId: rec.runId, status: rec.status, events: rec.events, output: rec.output, error: rec.error });
  });

  // Live stream: emit events as they accrue, then a final status, then close.
  app.get("/api/runs/:runId/stream", (c) => {
    const runId = c.req.param("runId");
    return streamSSE(c, async (stream) => {
      let cursor = 0;
      // Stream until the run settles (or the client disconnects).
      for (;;) {
        const rec = rm.get(runId);
        if (!rec) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "unknown run" }) });
          return;
        }
        while (cursor < rec.events.length) {
          await stream.writeSSE({ event: "event", data: JSON.stringify(rec.events[cursor]) });
          cursor += 1;
        }
        if (rec.status !== "running") {
          await stream.writeSSE({ event: "status", data: JSON.stringify({ status: rec.status, error: rec.error }) });
          return;
        }
        if (stream.aborted) return;
        await stream.sleep(100);
      }
    });
  });

  return app;
}
