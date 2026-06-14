// Local HTTP API over the core store — the backend the React web-UI (and the
// Tauri sidecar) talk to. Read endpoints first; mutations land in later slices.
// The db is injected so the API is testable with a seeded in-memory store.

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { listTasks, getTask, getStages, createTask, setStageGate } from "../core/store/db.js";
import { getSteps } from "../core/store/steps.js";
import { getCosts } from "../core/store/execute.js";
import { boardColumns, attentionQueue, startTask, completeStage, moveToStage } from "../core/pipeline/engine.js";
import { loadWorkspaceData, type WorkspaceData } from "../core/data/loader.js";
import { resolveProjectRoot } from "../core/workspace/project-id.js";
import { taskDetail } from "../core/plugins/task-journal/adapter.js";
import { saveActiveProfile } from "@digital-threads/aimux/core";
import { addSubscription, type AddSubscriptionResult } from "../core/plugins/aimux/adapter.js";
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
import { recallPrior, partitionHits, buildGraph, askSearch, type RecallHit } from "../core/knowledge/recall.js";
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
import { createTaskSession, parseCompleteness, type SessionLauncher } from "../core/automation/task-session.js";
import { createAimuxSessionLauncher } from "../core/automation/aimux-session-launcher.js";
import { getChatMessages, latestArtifact, createArtifact } from "../core/store/artifacts.js";
import { runPr, runDone, type PrOptions, type Sh } from "../core/pipeline/pr-done.js";
import { buildQaChecks } from "../core/quality/default-qa-checks.js";
import { commitWorktree } from "../core/automation/auto-commit.js";
import { worktreeBranch, removeWorktree } from "../core/security/sandbox.js";
import { browseDir } from "../core/workspace/fs-browse.js";
import type { RunSpecResult } from "../core/automation/orchestrate.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { advanceTask, runAndAdvance, type RunnerRegistry, type StageOutcome } from "../core/pipeline/conductor.js";
import { loomRegistry } from "../core/plugins/index.js";
import { getAllSettings, setSetting } from "../core/store/settings.js";
import { addAttachment, getAttachments, attachmentsPrompt } from "../core/store/attachments.js";
import { listMcp, addMcp, toggleMcp, removeMcp, testMcp, type McpProbe } from "../core/connectors/mcp.js";
import { beadsConnector } from "../core/connectors/beads.js";
import type { TaskDraft } from "../core/connectors/connector.js";
import { resolveFlow } from "../core/quality/flow-config.js";
import { runReview, reviewAction } from "../core/quality/review-runner.js";
import { runQa, type QaCheck } from "../core/quality/qa-runner.js";
import { reviewPrompt, parseFindings, type ReviewPass } from "../core/quality/review.js";

// Injected backends so the API is testable without touching real aimux/tj/fs.
export interface ApiDeps {
  loadWorkspace?: (root?: string) => Promise<WorkspaceData>;
  setActiveProfile?: (profileId: string) => void;
  addSubscription?: (name: string, opts: { cli?: string; model?: string }) => AddSubscriptionResult;
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
  /** Semantic search this project (default: task-journal ask --json). */
  search?: (query: string) => RecallHit[];
  /** Agent for the dialog stages (default: aimux cheap one-shot). */
  stageAgent?: StageAgent;
  /** Launcher for the per-task Claude session (default: aimux session launcher).
   *  When deps.stageAgent is set it wins (one-shot, for tests). */
  sessionLauncher?: SessionLauncher;
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
  /** Tracker import drafts (default: beads connector). */
  importDrafts?: () => TaskDraft[];
}

export function createApi(db: Database.Database, deps: ApiDeps = {}): Hono {
  const app = new Hono();
  const loadWorkspace = deps.loadWorkspace ?? loadWorkspaceData;
  const setActiveProfile = deps.setActiveProfile ?? saveActiveProfile;
  const addSub = deps.addSubscription ?? ((name: string, opts: { cli?: string; model?: string }) => addSubscription(name, opts));
  const memoryTask =
    deps.memoryTask ?? ((id: string) => taskDetail(resolveProjectRoot(process.cwd()), id));
  const projectsList = deps.listProjects ?? (() => listProjects());
  const projectAdd = deps.addProject ?? ((root: string) => addProject(root));
  const projectSetActive = deps.setActiveProject ?? ((id: string) => setActiveProject(id));
  const projectActive = deps.activeProject ?? (() => activeProject());
  const loadEvents = deps.loadEvents ?? ((projectId: string) => loadLoomEvents(projectId));
  const recall =
    deps.recall ?? ((query: string) => recallPrior(resolveProjectRoot(process.cwd()), query));
  const search =
    deps.search ?? ((query: string) => askSearch(resolveProjectRoot(process.cwd()), query));
  const stageAgent = deps.stageAgent ?? createAimuxStageAgent();
  // Dialog stages run inside the task's ONE persistent session. deps.stageAgent
  // (tests) wins as a one-shot; otherwise each call goes through TaskSession so
  // analysis → brainstorm → spec share accumulating context.
  const sessionLauncher = deps.sessionLauncher ?? createAimuxSessionLauncher();
  const stageAgentFor = (taskId: string, stage: string): StageAgent => {
    if (deps.stageAgent) return deps.stageAgent;
    const session = createTaskSession(db, taskId, { launcher: sessionLauncher });
    return (prompt: string) => session.send(prompt, { stage }).then((r) => r.text);
  };
  const taskSpec = (id: string) => {
    const t = getTask(db, id);
    return (t?.description || t?.title || id) + attachmentsPrompt(db, id);
  };
  const reviewPass =
    deps.reviewPass ??
    ((key: string, target: string): ReviewPass => ({
      key,
      run: async () => parseFindings(key, await stageAgent(reviewPrompt(key, target))),
    }));
  const isGitRepo = (p: string) => existsSync(pathJoin(p, ".git"));
  const realSh: Sh = (cmd, args, cwd) => {
    try {
      const stdout = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, stdout };
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      return { code: err.status ?? 1, stdout: err.stdout ?? "" };
    }
  };
  /** QA checks for a task: explicit override, else real tests/build in its repo. */
  const qaChecksFor = (taskId: string): QaCheck[] => {
    const keys = resolveFlow("qa");
    if (deps.qaChecks) return deps.qaChecks(keys);
    const t = getTask(db, taskId);
    return buildQaChecks(keys, { repoRoot: t?.repo || process.cwd() });
  };
  // Persist a stage result so the panel can re-display it on revisit (history).
  const saveResult = (taskId: string, stage: string, kind: string, data: unknown) =>
    createArtifact(db, { id: `art_${randomUUID().slice(0, 8)}`, taskId, stage, kind, content: JSON.stringify(data), status: "accepted" });
  const loadResult = <T,>(taskId: string, kind: string): T | null => {
    const a = latestArtifact(db, taskId, kind);
    if (!a) return null;
    try { return JSON.parse(a.content) as T; } catch { return null; }
  };

  // L13 — default stage runners: wire each pipeline stage to its layer. Override
  // via deps.runners for tests. Interactive stages (brainstorm/spec) are driven
  // by the UI; the conductor auto-runs them best-effort here for autopilot.
  // The impl stage runs in an isolated git worktree (sandbox) when the task's
  // repo is a git repo; the agent's edits are auto-committed onto branch
  // loom/<taskId> so the PR stage has content to push.
  async function runImplStage(taskId: string): Promise<StageOutcome> {
    const t = getTask(db, taskId);
    const repoRoot = t?.repo;
    const useSandbox = !!repoRoot && isGitRepo(repoRoot);
    const ids = buildSpineIds({ repoRoot: repoRoot || process.cwd(), taskId });
    if (useSandbox) removeWorktree(repoRoot!, taskId); // clear any stale worktree from a prior run
    const runId = startSpecRun(rm, db, taskId, taskSpec(taskId), ids, useSandbox ? { sandbox: { repoRoot: repoRoot! } } : {});
    const rec = await rm.wait(runId);
    const result = rec.result as RunSpecResult | undefined;
    if (useSandbox && result?.cwd) commitWorktree(result.cwd, `loom: ${t?.title ?? taskId}`);
    return { ok: rec.status === "done" && (result?.exec?.dag?.ok ?? true) };
  }
  const doneProjectId = () => projectActive()?.projectId ?? "default";
  const defaultRunners: RunnerRegistry = {
    analysis: async (_d, id) => { await runAnalysis(db, id, taskSpec(id), stageAgentFor(id, "analysis")); return { ok: true }; },
    brainstorm: async () => ({ ok: true }), // human-driven via StageDialog
    spec: async (_d, id) => {
      const art = await draftSpec(db, id, stageAgentFor(id, "spec"));
      const { complete, note } = parseCompleteness(art.content); // completeness-gate: don't advance a doubtful spec
      if (!complete) return { ok: true, needsAttention: true, note };
      acceptSpec(db, id);
      return { ok: true };
    },
    rd: async (_d, id) => runImplStage(id),
    impl: async (_d, id) => runImplStage(id),
    review: async (_d, id) => {
      const res = await runReview(resolveFlow("review"), (k) => reviewPass(k, taskSpec(id)));
      saveResult(id, "review", "review-result", { result: res, action: reviewAction(res, "triage") });
      return { ok: res.passed, needsAttention: !res.passed };
    },
    qa: async (_d, id) => {
      const res = await runQa(qaChecksFor(id));
      saveResult(id, "qa", "qa-result", { result: res });
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
  app.get("/favicon.ico", (c) => c.body(null, 204)); // no favicon → quiet 204, not a console 404

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

  // Move a task to a stage (board drag-drop). Body: { stageKey }. Repositions
  // only — does not start a run.
  app.post("/api/tasks/:id/move", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { stageKey?: unknown };
    const stageKey = typeof body.stageKey === "string" ? body.stageKey : "";
    const current = moveToStage(db, id, stageKey);
    if (current === null && stageKey !== "done") return c.json({ error: "unknown stage" }, 400);
    return c.json({ current });
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

  // Add an aimux subscription (D5.1). Body: { name, cli?, model? }.
  app.post("/api/accounts/subscription", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; cli?: unknown; model?: unknown };
    if (typeof b.name !== "string" || !b.name) return c.json({ error: "name required" }, 400);
    const res = addSub(b.name, { cli: typeof b.cli === "string" ? b.cli : undefined, model: typeof b.model === "string" ? b.model : undefined });
    return res.ok ? c.json(res) : c.json(res, 400);
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
  // L7.2 — semantic search over this project's memory.
  app.get("/api/knowledge/search", (c) => {
    const q = c.req.query("q") ?? "";
    return c.json({ hits: q ? search(q) : [] });
  });
  // L7.3 — problem→solution graph derived from recall hits.
  app.get("/api/knowledge/graph", (c) => {
    const q = c.req.query("q") ?? "";
    return c.json(buildGraph(q ? recall(q) : []));
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
  // Body: { connector?: boolean, base?: string }. With connector=true the PR
  // stage pushes branch loom/<id> and opens a PR via gh (irreversible — opt-in).
  app.post("/api/tasks/:id/pr/run", async (c) => {
    const id = c.req.param("id");
    const t = getTask(db, id);
    if (!t) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { connector?: unknown; base?: unknown };
    let opts: PrOptions = deps.prOptions?.(id) ?? {};
    if (body.connector === true) {
      if (!t.repo) return c.json({ error: "task has no repo to push from" }, 400);
      opts = {
        ...opts,
        connector: true,
        repoRoot: t.repo,
        branch: opts.branch ?? worktreeBranch(id),
        base: typeof body.base === "string" ? body.base : opts.base ?? t.branch ?? "main",
        sh: opts.sh ?? realSh,
      };
    }
    return c.json({ pr: runPr(db, id, opts) });
  });

  // ─── filesystem browse (folder pickers) ───────────────────────────────────────
  app.get("/api/fs/list", (c) => c.json(browseDir(c.req.query("path"))));
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
    return c.json(await runAnalysis(db, id, taskSpec(id), stageAgentFor(id, "analysis")));
  });
  app.get("/api/tasks/:id/brainstorm/messages", (c) =>
    c.json({ messages: getChatMessages(db, c.req.param("id"), "brainstorm") }),
  );
  app.post("/api/tasks/:id/brainstorm/message", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message : undefined;
    return c.json({ question: await brainstormTurn(db, id, stageAgentFor(id, "brainstorm"), message) });
  });
  app.post("/api/tasks/:id/brainstorm/done", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json({ summary: await summarizeBrainstorm(db, id, stageAgentFor(id, "brainstorm")) });
  });
  app.get("/api/tasks/:id/spec", (c) =>
    c.json({ spec: latestArtifact(db, c.req.param("id"), "spec-md") ?? null }),
  );
  app.post("/api/tasks/:id/spec/draft", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    return c.json({ spec: await draftSpec(db, id, stageAgentFor(id, "spec")) });
  });
  app.post("/api/tasks/:id/spec/return", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { comment?: unknown };
    const comment = typeof body.comment === "string" ? body.comment : "";
    return c.json({ spec: await reviseSpec(db, id, comment, stageAgentFor(id, "spec")) });
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
  // D5.4/5.5 — import open tracker items as tasks on the board.
  app.post("/api/connectors/import", (c) => {
    const drafts = (deps.importDrafts ?? (() => beadsConnector().import()))();
    let created = 0;
    for (const d of drafts) {
      createTask(db, { id: `t-${randomUUID().slice(0, 8)}`, title: d.title, description: d.description });
      created += 1;
    }
    return c.json({ created });
  });

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
    const payload = { result, action: reviewAction(result, mode) };
    saveResult(id, "review", "review-result", payload);
    return c.json(payload);
  });
  app.post("/api/tasks/:id/qa/run", async (c) => {
    const id = c.req.param("id");
    const t = getTask(db, id);
    if (!t) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { checks?: unknown };
    const override = Array.isArray(body.checks) ? { passes: body.checks as string[] } : undefined;
    const keys = resolveFlow("qa", undefined, override);
    const checks = deps.qaChecks ? deps.qaChecks(keys) : buildQaChecks(keys, { repoRoot: t.repo || process.cwd() });
    const result = await runQa(checks);
    saveResult(id, "qa", "qa-result", { result });
    return c.json({ result });
  });
  // Stored stage results (history re-display when revisiting a completed stage).
  app.get("/api/tasks/:id/analysis", (c) => {
    const a = latestArtifact(db, c.req.param("id"), "analysis");
    let result: unknown = null;
    if (a) { try { result = JSON.parse(a.content); } catch { result = null; } }
    return c.json({ result });
  });
  app.get("/api/tasks/:id/review", (c) => c.json(loadResult(c.req.param("id"), "review-result") ?? { result: null }));
  app.get("/api/tasks/:id/qa", (c) => c.json(loadResult(c.req.param("id"), "qa-result") ?? { result: null }));

  // ─── runs (L4.4) ────────────────────────────────────────────────────────────

  // Start a stage run (async). Returns { runId } immediately; progress streams
  // via /api/runs/:runId/stream.
  app.post("/api/tasks/:id/stages/:key/run", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const runId = startRun(id, c.req.param("key"));
    return c.json({ runId });
  });

  // Inject stdin into a live run (loom-isd.13 — intervene in the session).
  app.post("/api/runs/:runId/stdin", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { data?: unknown };
    const data = typeof b.data === "string" ? b.data : "";
    const ok = rm.sendInput(c.req.param("runId"), data);
    return ok ? c.json({ ok: true }) : c.json({ error: "run not accepting input" }, 404);
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
