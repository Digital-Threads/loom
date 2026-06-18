// Local HTTP API over the core store — the backend the React web-UI (and the
// Tauri sidecar) talk to. Read endpoints first; mutations land in later slices.
// The db is injected so the API is testable with a seeded in-memory store.

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { listTasks, getTask, getStages, createTask, deleteTask, setStageGate, getTaskSession, setTaskProfile, updateTaskStatus, findTaskByExternalRef } from "../core/store/db.js";
import { getSteps } from "../core/store/steps.js";
import { getCosts, insertRun, completeRun, reconcileInterruptedRuns } from "../core/store/execute.js";
import { boardColumns, attentionQueue, startTask, completeStage, moveToStage } from "../core/pipeline/engine.js";
import { loadWorkspaceData, type WorkspaceData } from "../core/data/loader.js";
import { resolveProjectRoot, deriveProjectId } from "../core/workspace/project-id.js";
import { taskDetail, taskPack, boardTaskJournal, boardTaskStory, exportEventsSafe, renderJournalFromEvents, bindExternal, tasksFromEvents, type TjEvent } from "../core/plugins/task-journal/adapter.js";
import { saveActiveProfile, loadActiveProfile, loadConfig, fetchRateLimits, expandHome, getProfile } from "@digital-threads/aimux/core";
import { homedir } from "node:os";
import { relocateSession } from "../core/automation/session-relocate.js";
import { pickFallbackProfile, shouldAutoFallback, type ProfileLimit } from "../core/automation/auto-fallback.js";
import { addSubscription, removeSubscription, type AddSubscriptionResult } from "../core/plugins/aimux/adapter.js";
import { createAuthManager } from "../core/plugins/aimux/auth-login.js";
import {
  listProjects,
  addProject,
  removeProject,
  activeProject,
  setActiveProject,
  type ProjectEntry,
} from "../core/workspace/projects.js";
import { streamSSE } from "hono/streaming";
import { createRunManager, type RunManager } from "../core/automation/run-manager.js";
import { buildSpineIds, spineEnv } from "../core/spine/ids.js";
import { recordRunCost } from "../core/observability/cost-recorder.js";
import { tokenEventsByTime, tokenUsageBySession } from "../core/plugins/token-pilot/adapter.js";
import { listSessions } from "../core/plugins/aimux/adapter.js";
import { loadLoomEvents } from "../core/spine/event-bus.js";
import type { LoomEvent } from "../core/spine/event.js";
import { boardTotals, agentPerformance, failureReasons } from "../core/observability/metrics.js";
import { recallPrior, partitionHits, askSearch, type RecallHit } from "../core/knowledge/recall.js";
import {
  runAnalysis,
  brainstormTurn,
  summarizeBrainstorm,
  draftSpec,
  reviseSpec,
  acceptSpec,
  parseAnalysis,
  type StageAgent,
} from "../core/pipeline/stage-runners.js";
import { createAimuxStageAgent } from "../core/pipeline/stage-agent.js";
import { createTaskSession, parseCompleteness, declaresRemainingWork, detectRateLimit, type SessionLauncher } from "../core/automation/task-session.js";
import type { SessionControl } from "../core/automation/live-session.js";
import { createClaudeRuntime } from "../core/runtime/claude-runtime.js";
import type { AgentRuntime } from "../core/runtime/agent-runtime.js";
import { getChatMessages, latestArtifact, createArtifact, getArtifacts } from "../core/store/artifacts.js";
import { runPr, runDone, prConnectorStatus, defaultBranch, type PrOptions, type Sh } from "../core/pipeline/pr-done.js";
import { buildQaChecks } from "../core/quality/default-qa-checks.js";
import { commitWorktree, rebaseWorktreeOnBase } from "../core/automation/auto-commit.js";
import { worktreeBranch, ensureWorktree, worktreePath } from "../core/security/sandbox.js";
import { browseDir } from "../core/workspace/fs-browse.js";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { safeResolveAny, realContained } from "../core/security/path-safety.js";
import { audit } from "../core/security/audit.js";
import { join as pathJoin, isAbsolute } from "node:path";
import { advanceTask, runAndAdvance, type RunnerRegistry, type AdvanceOptions } from "../core/pipeline/conductor.js";
import { loomRegistry } from "../core/plugins/index.js";
import { LAYER_CATALOG } from "../core/dashboard/layer-catalog.js";
import { renderDossier, diffSummary } from "../core/dashboard/dossier.js";
import { getAllSettings, setSetting, getSetting } from "../core/store/settings.js";
import {
  loadSecurityConfig,
  saveCommandPolicy,
  saveSecretConfig,
  policySummary,
  defaultDenySources,
  scanWithCustom,
  DEFAULT_SECRET_KINDS,
} from "../core/security/policy-config.js";
import { addAttachment, getAttachments, attachmentsPrompt } from "../core/store/attachments.js";
import { addMcp, toggleMcp, removeMcp, testMcp, type McpProbe } from "../core/connectors/mcp.js";
import type { TaskDraft } from "../core/connectors/connector.js";
import { resolveFlow } from "../core/quality/flow-config.js";
import { isValidSkillName } from "../core/skills/skills.js";
import { reviewAction, reviewHolds, type ReviewAction } from "../core/quality/review-runner.js";
import { runQa, type QaCheck } from "../core/quality/qa-runner.js";
import { reviewPrompt, parseFindings, aggregateFindings, type ReviewPass, type Finding, type ReviewResult } from "../core/quality/review.js";
import { checkPrerequisites, type PrereqReport } from "../core/doctor/prereqs.js";

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
  /** One-shot agent for AI skill generation (default: aimux headless). */
  skillAgent?: (prompt: string) => Promise<string>;
  /** Launcher for the per-task agent session (default: runtime's launcher).
   *  When deps.stageAgent is set it wins (one-shot, for tests). Partial control
   *  surface so test mocks can supply only the methods a case exercises. */
  sessionLauncher?: SessionLauncher & Partial<SessionControl>;
  /** The agent engine behind the pipeline (default: ClaudeRuntime). Everything
   *  Claude-specific — launcher, skills, connectors, recall — lives behind this. */
  runtime?: AgentRuntime;
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
  /** Environment prerequisite check (default: which/where probe of REQUIRED_TOOLS). */
  prereqs?: () => PrereqReport;
}

// Claude's config dir for an aimux profile: the source profile inherits the
// default ~/.claude; every other profile has its own dir (where aimux points
// CLAUDE_CONFIG_DIR). Used to relocate a session across accounts on switch.
const defaultClaudeDir = process.env.CLAUDE_CONFIG_DIR || pathJoin(homedir(), ".claude");
function profileConfigDir(p: { is_source?: boolean; path: string }): string {
  return p.is_source ? defaultClaudeDir : expandHome(p.path);
}
/** Make a task's session resumable under `profileName` by copying its transcript
 *  into that profile's config dir (best-effort) — so a mid-task account switch
 *  resumes the SAME conversation under the new subscription instead of falling
 *  back to the old account. */
function relocateSessionForProfile(profileName: string, sessionId: string): void {
  try {
    const cfg = loadConfig();
    if (!cfg) return;
    const dirs = [defaultClaudeDir, ...Object.values(cfg.profiles).map(profileConfigDir)];
    relocateSession(sessionId, dirs, profileConfigDir(getProfile(cfg, profileName)));
  } catch {
    /* best-effort: a missing profile/dir just means no relocation */
  }
}

export function createApi(db: Database.Database, deps: ApiDeps = {}): Hono {
  const app = new Hono();
  const loadWorkspace = deps.loadWorkspace ?? loadWorkspaceData;
  const setActiveProfile = deps.setActiveProfile ?? saveActiveProfile;
  const addSub = deps.addSubscription ?? ((name: string, opts: { cli?: string; model?: string }) => addSubscription(name, opts));
  const doctorReport = deps.prereqs ?? (() => checkPrerequisites());
  const memoryTask =
    deps.memoryTask ?? ((id: string) => taskDetail(resolveProjectRoot(process.cwd()), id));
  const projectsList = deps.listProjects ?? (() => listProjects());
  const projectAdd = deps.addProject ?? ((root: string) => addProject(root));
  const projectSetActive = deps.setActiveProject ?? ((id: string) => setActiveProject(id));
  const projectActive = deps.activeProject ?? (() => activeProject());
  // A project root must be an absolute, existing directory — guards against junk
  // like a relative "app" that silently resolves to the server's cwd. Only
  // enforced with the real project store (injected addProject owns validation).
  const validRoot = (r: string) => !!deps.addProject || (isAbsolute(r) && existsSync(r));
  // Backfill: tasks created before project_id → assign to the home project (this
  // server's db is its cwd project) so the cross-project board groups/filters them.
  try {
    const home = deriveProjectId(resolveProjectRoot(process.cwd()));
    db.prepare("UPDATE tasks SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(home);
  } catch { /* fresh db or no tasks */ }
  const loadEvents = deps.loadEvents ?? ((projectId: string) => loadLoomEvents(projectId));
  // Scope recall/search to the ACTIVE project (resolved per call), not the
  // server's cwd — otherwise task-journal looks in the wrong repo and recall
  // always returns 0 (loom-g2qf).
  // The bundled recall runner passes `--limit`, but the installed task-journal
  // CLI renamed that flag to `--k` — the mismatch makes recall throw and (since
  // recallPrior swallows errors → []) silently return nothing on real data.
  // Inject a runner with the correct flag so recall + the graph actually work.
  const recallRunner = (query: string, k: number, projectRoot: string) =>
    // `--` ends option parsing so a query starting with `-` can't smuggle flags
    // into task-journal (argv injection); the user-controlled value stays last.
    execFileSync("task-journal", ["recall", "--json", "--k", String(k), "--", query], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  // The agent engine: one swappable runtime hides everything Claude-specific
  // (launcher, skills, connectors, recall). Declared early so recall below can
  // fall back to it; the per-task launcher is read off it further down.
  const runtime = deps.runtime ?? createClaudeRuntime({ sandbox: () => getSetting<boolean>(db, "sandbox.enabled", false) });
  const recall =
    deps.recall ?? runtime.recall ?? ((query: string) => recallPrior(resolveProjectRoot(projectActive()?.root ?? process.cwd()), query, { run: recallRunner }));
  const search =
    deps.search ?? ((query: string) => askSearch(resolveProjectRoot(projectActive()?.root ?? process.cwd()), query));
  // In production, review runs through the task's session (stageAgentFor) so the
  // agent has full context. Tests inject deps.reviewPass / deps.stageAgent to
  // avoid spawning real processes.
  // Build a review pass factory. Tests inject deps.reviewPass (sync mock);
  // production runs review in the task's session so the agent has full context.
  const makeReviewPass = (id: string, targetHint: string) => (key: string): ReviewPass => {
    if (deps.reviewPass) return deps.reviewPass(key, targetHint);
    if (deps.stageAgent) return { key, run: async () => parseFindings(key, await deps.stageAgent!(reviewPrompt(key, targetHint))) };
    const agent = stageAgentFor(id, "review");
    return { key, run: async () => parseFindings(key, await agent(reviewPrompt(key, targetHint))) };
  };

  // ─── Multi-reviewer review pipeline ──────────────────────────────────────────
  // The review stage runs THREE reviewers in order, accumulating findings. Each
  // reviewer is just a prompt to the task's own session — the agent runs the
  // skill/loop under the hood and returns findings. Findings accumulate across
  // reviewers (merge by pass key) and are fixed ONCE at the end (saves tokens).
  // Manual/gated: run the first reviewer, park; the user approves & runs the next
  // via /review/run. Autopilot: run all three back-to-back.
  // Cost guard: review must NOT run the full test suite/build — on a large repo
  // that's the biggest token sink, and tests are the QA stage's job. Reviewers
  // read the code + diff (token-pilot smart_diff) only.
  const REVIEW_NO_RUN =
    " ВАЖНО (экономия токенов): НЕ запускай тесты, билд или полный тест-сьют — ревьюй ТОЛЬКО чтением кода и diff (token-pilot smart_diff/read_symbol). Прогон тестов — задача стадии QA, не ревью.";
  const REVIEWERS: { key: string; label: string; instruction: string }[] = [
    {
      key: "self",
      label: "Своё ревью",
      instruction:
        "Сделай собственное ревью ТЕКУЩИХ изменений кода в этом worktree. Прочитай изменённые файлы и diff. Ищи реальные баги, а не стиль." + REVIEW_NO_RUN,
    },
    {
      key: "ralph",
      label: "Ralph-loop",
      instruction:
        "Запусти ralph-loop ревью с МАКСИМУМ 3 итерациями над текущими изменениями кода: на каждой итерации углубляй анализ. Верни ВСЕ найденные за все итерации проблемы." + REVIEW_NO_RUN,
    },
    {
      key: "adversarial",
      label: "Adversarial",
      instruction:
        "Запусти скилл /adversarial-review над текущими изменениями кода — пусть он попытается сломать решение (краевые случаи, неверный ввод, гонки, обход проверок). Верни найденные проблемы." + REVIEW_NO_RUN,
    },
  ];
  const REVIEWER_KEYS = REVIEWERS.map((r) => r.key);

  interface ReviewPayload {
    result: ReviewResult;
    action: ReviewAction;
    /** Which reviewers have already run, in pipeline order. */
    reviewersDone: string[];
  }

  /** Run ONE reviewer in the task's session → its findings (tagged by its key). */
  const runReviewer = (id: string, reviewer: (typeof REVIEWERS)[number]): Promise<Finding[]> =>
    makeReviewPass(id, reviewer.instruction)(reviewer.key).run();

  /** Merge a reviewer's findings into the accumulated review-result (replacing
   *  that reviewer's prior contribution so re-runs are idempotent), re-aggregate,
   *  and persist. `reset` starts a fresh pipeline (drops all prior findings). */
  const recordReviewer = (id: string, reviewerKey: string, findings: Finding[], opts: { reset?: boolean } = {}): ReviewPayload => {
    const prev = opts.reset ? null : loadResult<ReviewPayload>(id, "review-result");
    const active = resolvedReviewerKeys();
    // Keep prior findings only from reviewers still enabled (drop ones whose
    // reviewer was disabled mid-pipeline), replacing this reviewer's own.
    const kept = (prev?.result.findings ?? []).filter((f) => f.pass !== reviewerKey && active.includes(f.pass));
    const result = aggregateFindings([...kept, ...findings]);
    const doneSet = new Set(opts.reset ? [] : prev?.reviewersDone ?? []);
    doneSet.add(reviewerKey);
    const reviewersDone = active.filter((k) => doneSet.has(k));
    const payload: ReviewPayload = { result, action: reviewAction(result, "triage"), reviewersDone };
    saveResult(id, "review", "review-result", payload);
    return payload;
  };

  /** Fix ALL accumulated findings in one impl-session pass, then commit. Shared
   *  by /review/fix (manual) and the autopilot review runner (auto-fix). */
  const fixAllFindings = async (id: string, findings: Finding[]): Promise<void> => {
    const list = findings.map((f) => `- [${f.severity}] ${f.file ? `${f.file}: ` : ""}${f.message}`).join("\n");
    await sessionSend(id, "impl", `Code review нашёл проблемы. Исправь их в коде (реальные изменения, при необходимости делегируй субагентам), затем кратко отчитайся. Проблемы:\n${list}\nВ конце строкой ИТОГ.`);
    const t = getTask(db, id);
    if (t?.repo && isGitRepo(t.repo)) commitWorktree(ensureWorktree(t.repo, id).path, `loom: fix review findings — ${t.title}`);
  };

  /** Re-review (fresh "self" pass, pipeline reset) verifying the prior findings
   *  against the now-fixed code; returns only what still remains. */
  const reReviewAfterFix = async (id: string, priorFindings: Finding[]): Promise<ReviewPayload> => {
    const priorList = priorFindings.map((f) => `[${f.severity}] ${f.file ? `${f.file}: ` : ""}${f.message}`).join("\n");
    const reReviewTarget =
      `You just fixed the issues listed below. Now re-review the CURRENT code. ` +
      `For each prior finding, verify whether it's fixed. ` +
      `Return ONLY a JSON array of findings that STILL REMAIN (not fixed). ` +
      `Do NOT re-report fixed issues. Empty array if all fixed.\n\n` +
      `PRIOR FINDINGS:\n${priorList}\n\nReturn JSON array only, no prose.`;
    // The post-fix verification pass is labelled as the first enabled reviewer so
    // it honours the configurable flow.review set (not a hardcoded "self").
    const firstKey = resolvedReviewerKeys()[0];
    const verifyFindings = await makeReviewPass(id, reReviewTarget)(firstKey).run();
    return recordReviewer(id, firstKey, verifyFindings, { reset: true });
  };
  // Dialog stages run inside the task's ONE persistent session. deps.stageAgent
  // (tests) wins as a one-shot; otherwise each call goes through TaskSession so
  // analysis → brainstorm → spec share accumulating context.
  const sessionLauncher: SessionLauncher & Partial<SessionControl> = deps.sessionLauncher ?? runtime.launcher;
  const authMgr = createAuthManager(); // in-UI profile authorization (aimux auth login via PTY)
  // One cwd for the whole task = its worktree (created once, reused by every
  // stage), so the live process edits in isolation. Non-git repos use the repo.
  const taskCwd = (id: string): string | undefined => {
    const t = getTask(db, id);
    if (t?.repo && isGitRepo(t.repo)) return ensureWorktree(t.repo, id).path;
    return t?.repo || undefined;
  };
  // The DEDICATED task-journal project the agent wrote to: a git task's own
  // worktree, which is 1:1 with the board task. Non-git / no-repo tasks share a
  // project with other tasks, so there is no journal we can attribute to them —
  // returns null (we never read or tag a shared project). Uses worktreePath()
  // (NOT ensureWorktree) so a READ never recreates a deleted worktree. The id is
  // a filesystem path segment via worktreePath(), so it is format-guarded here.
  const safeTaskId = (id: string) => /^[A-Za-z0-9._-]+$/.test(id) && !id.startsWith("-");
  const journalProjectRoot = (id: string): string | null => {
    if (!safeTaskId(id)) return null;
    const t = getTask(db, id);
    if (t?.repo && isGitRepo(t.repo)) return resolveProjectRoot(worktreePath(id));
    return null;
  };
  // Refresh per-task cost after a stage: token-pilot's own used/saved stats
  // (spine-tagged via LOOM_TASK_ID) + the live session's exact $ spent. No
  // separate counter — we read what token-pilot already tracks.
  const recordSessionCost = (id: string, repoRoot: string) => {
    try {
      const sid = getTaskSession(db, id).sessionId;
      const spent = sid ? sessionLauncher.costOf?.(sid) : undefined;
      recordRunCost(db, id, { tokenEvents: tokenEventsByTime(repoRoot), spent, sessionId: sid ?? undefined });
    } catch {
      /* cost is best-effort */
    }
  };
  // manual/gated: agent may freely read/edit in the worktree + run git; anything
  // else is denied and surfaced for approval. autopilot: full access (no list).
  const DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git *)", "TodoWrite"];
  const allowKey = (id: string) => `perm.allow.${id}`;
  const taskAllowed = (id: string): string[] => getSetting<string[]>(db, allowKey(id), []);
  const allowedToolsFor = (id: string): string[] => [...DEFAULT_ALLOWED_TOOLS, ...taskAllowed(id)];
  // Capture tools the agent was denied (await user approval) after a send.
  const recordDenials = (id: string) => {
    try {
      const sid = getTaskSession(db, id).sessionId;
      const denials = sid ? sessionLauncher.denialsOf?.(sid) ?? [] : [];
      if (denials.length) saveResult(id, "permissions", "permission-denials", { denials });
    } catch {
      /* best-effort */
    }
  };
  // Send a stage instruction into the task's ONE session (tests inject a one-shot
  // deps.stageAgent). All stages share the session + the task worktree cwd, and
  // the spine env so plugin telemetry attributes to this task.
  // Live output sinks per task: when a stage runs via the run-manager, its
  // session output streams here → run-manager record → SSE to the UI.
  const streamSinks = new Map<string, (chunk: string) => void>();
  const sessionSend = async (id: string, stage: string, prompt: string, opts?: { raw?: boolean }): Promise<string> => {
    if (deps.stageAgent) return deps.stageAgent(prompt);
    const t = getTask(db, id);
    const repoRoot = t?.repo || process.cwd();
    const ids = buildSpineIds({ repoRoot, taskId: id });
    const autopilot = t?.run_mode === "autopilot";
    const { text } = await createTaskSession(db, id, { launcher: sessionLauncher }).send(prompt, {
      stage,
      raw: opts?.raw,
      cwd: taskCwd(id),
      env: spineEnv(ids),
      bypassPermissions: autopilot,
      allowedTools: autopilot ? undefined : allowedToolsFor(id),
      onChunk: streamSinks.get(id),
      profile: t?.profile ?? undefined, // run under the task's current subscription
    });
    recordSessionCost(id, repoRoot);
    recordDenials(id);
    saveResult(id, stage, "turn", { input: prompt, output: text }); // session transcript
    // Secret scan on the NORMAL execution path (not just the experimental
    // sandbox): flag leaked credentials in the agent's output so the Security
    // panel's audit trail is real for every run (loom-l6z1). Honours the
    // secret-scan on/off switch and any user-defined rules from the Security panel.
    const secCfg = loadSecurityConfig(db);
    const secrets = secCfg.secretScanEnabled ? scanWithCustom(text, secCfg.secretRules) : [];
    if (secrets.length) {
      audit({
        projectId: projectActive()?.projectId ?? "default",
        taskId: id,
        kind: "secret.found",
        message: `${secrets.length} potential secret(s) in agent output: ${[...new Set(secrets.map((s) => s.kind))].join(", ")}`,
        metrics: { count: secrets.length },
      });
    }
    // Surface a provider rate-limit so a stop reads as "limited, resets X" rather
    // than an ambiguous park. Cleared by the next non-limited turn (latest wins).
    const rl = detectRateLimit(text);
    saveResult(id, stage, "stop-reason", rl.hit ? { kind: "rate_limit", resetsAt: rl.resetsAt ?? null, profile: t?.profile ?? null } : { kind: "none" });
    // Trust the REAL outcome over the probe: the limits probe only reads the 5h
    // window header and can say "allowed" while the account is actually blocked
    // (a separate session limit). On a real hit, mark the profile rejected in the
    // cache so Accounts + auto-fallback don't treat it as healthy.
    if (rl.hit && t?.profile) markProfileRateLimited(t.profile);
    return text;
  };
  const stageAgentFor = (id: string, stage: string): StageAgent => (prompt: string) => sessionSend(id, stage, prompt);
  const taskSpec = (id: string) => {
    const t = getTask(db, id);
    return (t?.description || t?.title || id) + attachmentsPrompt(db, id);
  };
  const isGitRepo = (p: string) => existsSync(pathJoin(p, ".git"));
  const realSh: Sh = (cmd, args, cwd) =>
    new Promise((resolve) => {
      // async (execFile, not execFileSync): git push / gh create are network calls
      // that would block the server's event loop and freeze the UI if run sync.
      execFile(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (e, out, errOut) => {
        if (!e) return resolve({ code: 0, stdout: out });
        const err = e as { code?: number | string };
        const combined = `${out ?? ""}${errOut ?? ""}` || (err.code === "ENOENT" ? `${cmd}: command not found` : "");
        resolve({ code: typeof err.code === "number" ? err.code : 1, stdout: combined });
      });
    });
  // Default MCP reachability probe: spawn `command … --help` and read its exit
  // code. Without this wired, the Connectors "Test" button always reported
  // "no probe configured" (loom-ivvi). Sync to match the McpProbe contract.
  const realMcpProbe: McpProbe = (command, args) => {
    try {
      const r = spawnSync(command, args, { timeout: 5000, stdio: "ignore" });
      return { code: r.status ?? 1 }; // null status (spawn error/timeout) → fail
    } catch {
      return { code: 1 };
    }
  };
  /** A persisted per-stage flow config (the Quality view's editable QA checks),
   *  used as the column default for resolveFlow. undefined → built-in defaults. */
  const storedFlow = (stage: string): { passes: string[] } | undefined => {
    const v = getSetting<string[] | undefined>(db, `flow.${stage}`, undefined);
    return Array.isArray(v) && v.length ? { passes: v } : undefined;
  };
  /** Reviewers the user enabled (Quality view), in saved order. The host's
   *  reviewer pipeline (self/ralph/adversarial) is its own catalog, distinct from
   *  the package's generic review passes, so we resolve against REVIEWER_KEYS here
   *  rather than via resolveFlow. Persisted under flow.review. Empty/unset → all. */
  const resolvedReviewerKeys = (): string[] => {
    const stored = storedFlow("review")?.passes ?? [];
    // Validate against the catalog and dedupe: persisted config can carry unknown
    // or repeated keys; duplicates would break React keys / reorder and re-run a
    // reviewer. Empty/all-invalid → the full default set.
    const valid = [...new Set(stored.filter((k) => REVIEWER_KEYS.includes(k)))];
    return valid.length ? valid : REVIEWER_KEYS;
  };
  /** QA checks for a task: explicit override, else real tests/build in its repo. */
  const qaChecksFor = (taskId: string): QaCheck[] => {
    const keys = resolveFlow("qa", storedFlow("qa"));
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
  // ─── task-journal: the agent's reasoning for a board task ───────────────────
  // The agent writes its journal into the project of its cwd (its worktree).
  // That data lives in task-journal's own data dir and survives the worktree's
  // deletion — but to be safe we ALSO snapshot it at Done. Reads prefer the live
  // journal and fall back to the snapshot when the worktree is gone.
  const JOURNAL_SNAPSHOT_KIND = "journal-snapshot";
  /** A board task's story as Markdown. Prefer task-journal's OWN `export-pr`
   *  narrative (Summary / Changes / Why / Verification / Affected) while the
   *  worktree exists; then the Done-time snapshot of that story (survives the
   *  worktree's deletion); finally a raw-event render as a universal fallback
   *  (export --project still works after the dir is gone). */
  const boardJournalPack = (id: string): string => {
    const root = journalProjectRoot(id);
    if (!root) return "";
    if (existsSync(worktreePath(id))) {
      const story = boardTaskStory(root); // task-journal's native export-pr
      if (story.trim()) return story;
    }
    const snap = loadResult<{ events?: TjEvent[]; story?: string }>(id, JOURNAL_SNAPSHOT_KIND);
    if (snap?.story?.trim()) return snap.story;
    const live = boardTaskJournal(root);
    if (live.trim()) return live;
    return snap?.events ? renderJournalFromEvents(snap.events) : "";
  };
  /** Persist the agent's story + journal and bind it to loom:<id> (best-effort).
   *  Called at Done while the worktree still exists, so both the readable
   *  export-pr story and the raw events outlive cleanup. No-op for non-git
   *  tasks, which have no dedicated 1:1 journal project. */
  const snapshotJournal = (id: string): void => {
    try {
      const root = journalProjectRoot(id);
      if (!root) return; // only a git worktree is 1:1 with the board task
      const events = exportEventsSafe(root);
      if (!events.length) return;
      saveResult(id, "memory", JOURNAL_SNAPSHOT_KIND, { events, story: boardTaskStory(root) });
      for (const t of tasksFromEvents(events)) bindExternal(root, t.id, `loom:${id}`);
    } catch {
      /* journal snapshot is best-effort */
    }
  };
  const DIFF_SNAPSHOT_KIND = "diff-snapshot";
  /** Snapshot the task's `git diff --stat` at Done, while the worktree branch
   *  still exists. After the branch is merged + deleted the live diff is gone,
   *  so the History "Changes" would vanish without this stored copy. */
  const snapshotDiff = async (id: string): Promise<void> => {
    try {
      const t = getTask(db, id);
      if (!t?.repo) return;
      const base = t.branch ?? await defaultBranch(realSh, t.repo); // null branch → repo default (master), not "main"
      const diff = await diffSummary(realSh, t.repo, base, worktreeBranch(id));
      if (diff.trim()) saveResult(id, "memory", DIFF_SNAPSHOT_KIND, { diff });
    } catch {
      /* diff snapshot is best-effort */
    }
  };
  // Record a readable turn in the shared transcript. Stages that produce
  // structured results (review/qa/pr/done/brainstorm) call this so the user
  // actually SEES the outcome — the chat-first transcript renders only turns.
  const recordTurn = (taskId: string, stage: string, input: string, output: string) =>
    saveResult(taskId, stage, "turn", { input, output });
  const fmtReview = (r: { passed: boolean; findings: { severity: string; message: string; file?: string }[]; counts: Record<string, number> }): string => {
    if (r.passed && !r.findings.length) return "Code review: no issues found.";
    const lines = r.findings.map((f) => `• [${f.severity}] ${f.file ? `${f.file}: ` : ""}${f.message}`);
    return `Code review: ${r.passed ? "passed" : "blockers found"} — ${r.counts.bug ?? 0} bug(s), ${r.counts.warn ?? 0} warning(s), ${r.counts.info ?? 0} note(s).\n${lines.join("\n")}`;
  };
  const fmtQa = (r: { passed: boolean; results: { key: string; ok: boolean; output?: string }[] }): string => {
    const lines = r.results.map((c) => `${c.ok ? "✓" : "✗"} ${c.key}${c.output ? ` — ${c.output.split("\n")[0]}` : ""}`);
    return `QA checks: ${r.passed ? "all green" : "failures"}.\n${lines.join("\n")}`;
  };

  // L13 — default stage runners: each stage injects its instruction into the
  // task's ONE session. R&D = planning (decompose into self-sufficient subtasks,
  // NO code) → stored for review. Implementation = execute the plan in the task
  // worktree → auto-commit so PR has content. Both honour the completeness-gate.
  const RD_PROMPT =
    "Стадия R&D — планирование. Разбей задачу на самодостаточные подзадачи (план/DAG): для каждой опиши что именно реализуется, какие файлы затрагиваются и критерий готовности. Код пока НЕ пиши. В конце укажи статус строкой ИТОГ.";
  const IMPL_PROMPT =
    "Стадия реализации. Реализуй ВЕСЬ план целиком — все подзадачи/эпики, а НЕ только первый. Вноси реальные изменения в код (при необходимости делегируй субагентам), проверяй результат. Не останавливайся после одного эпика. Если по любой причине не успел доделать всё — в конце ОБЯЗАТЕЛЬНО строкой 'ИТОГ: НЕ ГОТОВО — <что осталось>'. Ставь 'ИТОГ: ГОТОВО' ТОЛЬКО когда весь план реализован и проверен.";
  const IMPL_CONTINUE_PROMPT =
    "Продолжай реализацию: возьми СЛЕДУЮЩИЕ невыполненные пункты плана и доведи их до конца (реальные изменения в коде + проверка). Когда весь план реализован и проверен — 'ИТОГ: ГОТОВО'; иначе 'ИТОГ: НЕ ГОТОВО — <что осталось>'.";
  const IMPL_MAX_CONTINUES = 6; // bound the auto-continue loop so a huge/looping plan parks instead of running forever
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
    rd: async (_d, id) => {
      const text = await sessionSend(id, "rd", RD_PROMPT); // plan only, no code
      saveResult(id, "rd", "rd-plan", { plan: text });
      const { complete, note } = parseCompleteness(text);
      return complete ? { ok: true } : { ok: true, needsAttention: true, note };
    },
    impl: async (_d, id) => {
      // Implement the WHOLE plan: keep continuing while the agent reports it's
      // not done OR its own text still lists leftover plan items, up to a cap.
      // This stops impl from advancing after only the first epic (the agent
      // sometimes stamps ГОТОВО while listing remaining work — that's a lie we
      // must not trust). If the cap is hit, park for the user instead.
      const settled = (text: string) => parseCompleteness(text).complete && !declaresRemainingWork(text);
      // The cost cap also applies WITHIN this stage: a long impl loops many
      // costly continues, and sessionSend updates the task's spend after each
      // one (api ~L301). Re-check between sends and park if over budget, so a
      // runaway implementation can't blow past the cap (loom-0xod).
      const capUsd = getSetting<number>(db, "cost.capUsd", 0);
      const overBudget = () =>
        capUsd > 0 &&
        getCosts(db, id).filter((r) => r.source === "aimux" && r.metric === "spent").reduce((s, r) => s + r.value, 0) >= capUsd;
      let text = await sessionSend(id, "impl", IMPL_PROMPT);
      for (let i = 0; i < IMPL_MAX_CONTINUES && !settled(text); i++) {
        if (overBudget()) {
          saveResult(id, "impl", "impl-report", { report: text });
          return { ok: true, needsAttention: true, note: `cost cap $${capUsd} reached mid-implementation` };
        }
        text = await sessionSend(id, "impl", IMPL_CONTINUE_PROMPT);
      }
      const t = getTask(db, id);
      const done = settled(text);
      // Mark the commit WIP when the plan isn't fully implemented, so a parked
      // impl (and any PR built from it) reads as incomplete (loom-3s07).
      if (t?.repo && isGitRepo(t.repo)) commitWorktree(ensureWorktree(t.repo, id).path, `loom${done ? "" : " WIP"}: ${t.title}`);
      saveResult(id, "impl", "impl-report", { report: text });
      if (done) return { ok: true };
      const note = parseCompleteness(text).note ?? "implementation still has remaining plan items";
      return { ok: true, needsAttention: true, note };
    },
    review: async (_d, id) => {
      // Review runs IN THE TASK'S SESSION (same context, same worktree) so the
      // agent sees the actual code and remembers what it implemented, and as a
      // PIPELINE of reviewers (self → ralph → adversarial) whose findings
      // accumulate. Manual/gated: run the first reviewer and park so the user can
      // approve & run the next via /review/run. Autopilot: run all three.
      const autopilot = getTask(db, id)?.run_mode === "autopilot";
      if (autopilot) {
        let payload: ReviewPayload | undefined;
        const activeKeys = resolvedReviewerKeys();
        for (let i = 0; i < activeKeys.length; i++) {
          const reviewer = REVIEWERS.find((r) => r.key === activeKeys[i])!;
          const findings = await runReviewer(id, reviewer);
          payload = recordReviewer(id, reviewer.key, findings, { reset: i === 0 });
        }
        recordTurn(id, "review", `Review (${activeKeys.join(" → ")})`, fmtReview(payload!.result));
        // Autopilot fixes the accumulated findings once, then re-reviews — no
        // human gate, so it must resolve the work rather than park on it.
        if (payload!.result.findings.length) {
          await fixAllFindings(id, payload!.result.findings);
          payload = await reReviewAfterFix(id, payload!.result.findings);
          recordTurn(id, "review", "Auto-fix + re-review (autopilot)", fmtReview(payload.result));
        }
        return { ok: payload!.result.passed, needsAttention: reviewHolds(payload!.result, "autopilot") };
      }
      const first = REVIEWERS.find((r) => r.key === resolvedReviewerKeys()[0])!;
      const findings = await runReviewer(id, first);
      const payload = recordReviewer(id, first.key, findings, { reset: true });
      recordTurn(id, "review", `Review — ${first.label}`, fmtReview(payload.result));
      // Always park: the user approves and runs the next reviewer (ralph, then
      // adversarial) before the accumulated findings are fixed once at the end.
      return { ok: payload.result.passed, needsAttention: true };
    },
    qa: async (_d, id) => {
      const res = await runQa(qaChecksFor(id));
      saveResult(id, "qa", "qa-result", { result: res });
      recordTurn(id, "qa", "Run the repo's checks", fmtQa(res));
      return { ok: res.passed, needsAttention: !res.passed };
    },
    pr: async (_d, id) => {
      // Rebase the worktree onto the current base first, so the PR/diff shows only
      // this task's changes — not drift from a base that moved during the run
      // (loom-705a). A conflict parks for the human to resolve the branch.
      const prT = getTask(db, id);
      const prWt = taskCwd(id);
      if (prWt && isGitRepo(prWt)) {
        const reb = rebaseWorktreeOnBase(prWt, [prT?.branch, "master", "main"]);
        if (reb.conflict) {
          const note = `Rebase onto ${reb.base} conflicts — resolve the task branch manually before opening the PR.`;
          saveResult(id, "pr", "pr-result", { description: "", created: false, connector: false, error: note });
          recordTurn(id, "pr", "Rebase needed", note);
          return { ok: true, needsAttention: true, note };
        }
      }
      const pr = await runPr(db, id, deps.prOptions?.(id) ?? {});
      saveResult(id, "pr", "pr-result", pr);
      recordTurn(id, "pr", "Generate the PR description", pr.description);
      // Opening the PR is the irreversible, opt-in step. When no PR was actually
      // created (description-only / connector off), park here for the human to
      // push + open it — don't silently advance the task to "done" with no PR.
      return { ok: true, needsAttention: !pr.created };
    },
    done: async (_d, id) => {
      runDone(db, id, { projectId: doneProjectId(), closeTask: () => deps.closeTask?.(id) });
      snapshotJournal(id); // after close: capture the full reasoning (incl. outcome) before worktree cleanup
      await snapshotDiff(id); // and freeze the git diff --stat before the branch is merged + deleted
      recordTurn(id, "done", "Finalize the task", "Task finished and closed.");
      const sid = getTaskSession(db, id).sessionId; // task finished → stop its live process, free resources
      if (sid) sessionLauncher.stop?.(sid);
      return { ok: true };
    },
  };
  const runners = deps.runners ?? defaultRunners;
  // Cost-cap guard for the conductor: read the configured USD cap + the task's
  // real aimux spend, so autopilot stops before a runaway bill (cap 0 = off).
  const advanceOpts = (): AdvanceOptions => ({
    costCapUsd: getSetting<number>(db, "cost.capUsd", 0),
    spentUsd: (taskId: string) =>
      getCosts(db, taskId)
        .filter((r) => r.source === "aimux" && r.metric === "spent")
        .reduce((sum, r) => sum + r.value, 0),
    // Halt the loop when the just-run stage hit the provider rate limit, instead
    // of firing the next stage into the exhausted profile. Reads the stop-reason
    // the session wrapper persisted (api ~L304).
    rateLimited: (taskId: string) => {
      const r = loadResult<{ kind: string; resetsAt?: string | null; profile?: string | null }>(taskId, "stop-reason");
      return r?.kind === "rate_limit" ? { resetsAt: r.resetsAt ?? null, profile: r.profile ?? null } : null;
    },
  });
  const resolveProjectId = (c: { req: { query: (k: string) => string | undefined } }) =>
    c.req.query("project") ?? projectActive()?.projectId ?? "default";
  // Durable runs: persist run records to the store so they survive a restart;
  // mark any 'running' rows interrupted on boot (their process is gone).
  if (!deps.runManager) reconcileInterruptedRuns(db);
  const rm =
    deps.runManager ??
    createRunManager({
      start: (rec) => {
        if (rec.taskId) insertRun(db, { id: rec.runId, taskId: rec.taskId, sessionId: getTaskSession(db, rec.taskId).sessionId ?? undefined });
      },
      settle: (rec) => {
        if (rec.taskId) completeRun(db, rec.runId, rec.status === "done" ? 0 : 1, rec.output.join("\n"), rec.error);
      },
    });
  // Run a single stage in the background, streaming the live session's output to
  // the run record (→ SSE). Intervene (stdin) injects guidance into the live
  // session mid-run. Returns a runId immediately.
  const startRun =
    deps.startRun ??
    ((taskId: string, stageKey: string) => {
      const projectId = projectActive()?.projectId ?? "default";
      return rm.start({ projectId, taskId }, async (ctx) => {
        streamSinks.set(taskId, ctx.appendOutput);
        ctx.onInput((data) => {
          const sid = getTaskSession(db, taskId).sessionId;
          if (sid) sessionLauncher.interject?.(sid, data);
        });
        try {
          // run the stage's agent and STREAM it. On a clean outcome, complete the
          // stage and activate the next one (the pipeline visibly moves forward).
          // A parked/failed outcome (e.g. review found issues) stays put for the
          // user. We complete ONLY this stage — no cascade into the next runner,
          // so interactive stages (brainstorm) aren't auto-skipped.
          const runner = runners[stageKey];
          const outcome = runner ? await runner(db, taskId, stageKey) : { ok: true };
          if (outcome.ok && !outcome.needsAttention) completeStage(db, taskId, stageKey);
          return { outcome };
        } finally {
          streamSinks.delete(taskId);
        }
      });
    });

  app.get("/api/health", (c) => c.json({ ok: true }));
  // D2.2 — first-run environment check: are the required CLIs on PATH? Wraps the
  // core prereqs probe so the onboarding wizard can show a status without a terminal.
  app.get("/api/doctor", (c) => c.json(doctorReport()));
  app.get("/favicon.ico", (c) => c.body(null, 204)); // no favicon → quiet 204, not a console 404

  // The 3 core modules' aggregated workspace. ?project=<id> loads a specific
  // registered project; otherwise the active project (D3) / cwd.
  app.get("/api/workspace", async (c) => {
    const pid = c.req.query("project");
    const root = pid ? projectsList().find((p) => p.projectId === pid)?.root : undefined;
    const ws = await loadWorkspace(root);
    return c.json({ ...ws, activeProfile: loadActiveProfile() });
  });

  // token-pilot usage joined to who ran it: each session attributed to its Loom
  // task (by session_id) and subscription (task.profile → aimux lastProfile),
  // plus a per-subscription rollup. So the UI can show task names, not raw ids,
  // and "how much each account spent / saved".
  app.get("/api/tokens", (c) => {
    const pid = c.req.query("project");
    const root = pid ? projectsList().find((p) => p.projectId === pid)?.root : projectActive()?.root;
    const projectRoot = resolveProjectRoot(root ?? process.cwd());
    const rows = tokenUsageBySession(projectRoot);
    const taskBySession = new Map(
      listTasks(db).filter((t) => t.session_id).map((t) => [t.session_id as string, t]),
    );
    const profBySession = new Map(listSessions().map((s) => [s.sessionId, s.profile]));
    const bySession = rows.map((r) => {
      const task = taskBySession.get(r.sessionId);
      const profile = (task?.profile || profBySession.get(r.sessionId) || "") as string;
      return { sessionId: r.sessionId, used: r.used, saved: r.saved, taskTitle: task?.title, profile };
    });
    const byProfileMap = new Map<string, { profile: string; used: number; saved: number }>();
    for (const s of bySession) {
      if (!s.profile) continue; // unattributed (non-Loom) usage doesn't belong in the per-account table (loom-hcpk)
      const e = byProfileMap.get(s.profile) ?? { profile: s.profile, used: 0, saved: 0 };
      e.used += s.used;
      e.saved += s.saved;
      byProfileMap.set(s.profile, e);
    }
    const byProfile = [...byProfileMap.values()].sort((a, b) => b.used - a.used);
    const totals = bySession.reduce((a, s) => ({ used: a.used + s.used, saved: a.saved + s.saved }), { used: 0, saved: 0 });
    return c.json({ totals, byProfile, bySession });
  });

  // ─── projects (D3) ─────────────────────────────────────────────────────────
  app.get("/api/projects", (c) =>
    c.json({ projects: projectsList(), active: projectActive()?.projectId ?? null }),
  );
  // Per-project dashboard: task count (by project_id) + token-pilot used/saved
  // (summed over the project root). Local file reads only — no network.
  app.get("/api/projects/stats", (c) => {
    const tasks = listTasks(db);
    const activeId = projectActive()?.projectId ?? null;
    const stats = projectsList().map((p) => {
      const taskCount = tasks.filter((t) => t.project_id === p.projectId).length;
      let used = 0, saved = 0;
      try {
        for (const r of tokenUsageBySession(resolveProjectRoot(p.root))) { used += r.used; saved += r.saved; }
      } catch { /* no token-pilot logs */ }
      return { projectId: p.projectId, name: p.name, root: p.root, tasks: taskCount, used, saved, active: p.projectId === activeId };
    });
    return c.json({ stats });
  });
  app.post("/api/projects", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown };
    const root = typeof body.root === "string" ? body.root.trim() : "";
    if (!root) return c.json({ error: "root required" }, 400);
    if (!validRoot(root)) return c.json({ error: "root must be an absolute path to an existing folder" }, 400);
    return c.json({ project: projectAdd(root) }, 201);
  });
  app.post("/api/projects/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { projectId?: unknown };
    const id = typeof body.projectId === "string" ? body.projectId : "";
    if (!id) return c.json({ error: "projectId required" }, 400);
    if (projectActive()?.projectId === id) return c.json({ error: "can't remove the default project" }, 400);
    removeProject(id);
    return c.json({ ok: true });
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
    const stop = loadResult<{ kind: string; resetsAt?: string | null; profile?: string | null }>(id, "stop-reason");
    return c.json({
      task,
      stages: getStages(db, id),
      steps: getSteps(db, id),
      costs: getCosts(db, id),
      stopReason: stop && stop.kind !== "none" ? stop : null, // why the task last stopped (e.g. rate_limit)
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
    const repo = typeof body.repo === "string" ? body.repo : "";
    // Resolve the task's project from its repo: an explicit projectId wins, else
    // match a registered project by root, else auto-register the repo as a project.
    let projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : undefined;
    if (!projectId && repo) {
      const canonical = resolveProjectRoot(repo);
      const existing = projectsList().find((p) => p.root === canonical)?.projectId;
      // Only auto-register a real absolute dir; otherwise leave it to the active project.
      projectId = existing ?? (validRoot(repo) ? projectAdd(repo).projectId : undefined);
    }
    if (!projectId) projectId = projectActive()?.projectId ?? undefined;
    const task = createTask(db, {
      id,
      title,
      repo: repo || undefined,
      branch: typeof body.branch === "string" ? body.branch : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      // Fall back to the global default run mode (Settings), not a hardcoded
      // "gated" — so the Settings "Default run mode" actually takes effect (loom-wkhe).
      run_mode: typeof body.run_mode === "string" ? body.run_mode : getSetting<string>(db, "run_mode", "gated"),
      route: Array.isArray(body.route) ? (body.route as string[]) : undefined,
      profile: typeof body.profile === "string" && body.profile ? body.profile : (loadActiveProfile() ?? undefined),
      projectId,
    });
    return c.json({ task }, 201);
  });

  // Delete a task and all its related rows. 200 {ok:true} if it existed, else 404.
  // First kill any live process and drop its stream sink so an in-flight run
  // can't resurrect orphan rows (runs/cost) under the just-deleted task.
  app.delete("/api/tasks/:id", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const sid = getTaskSession(db, id).sessionId;
    sessionLauncher.stop?.(sid ?? "");
    streamSinks.delete(id);
    deleteTask(db, id);
    return c.json({ ok: true });
  });

  // Stop the task's active run + its live session process. Idempotent: no active
  // run → still { ok:true }. 404 only when the task itself is unknown.
  app.post("/api/tasks/:id/stop", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    // Stop every run for the task (not only the first "running" one) + kill the
    // live agent process, so a stop is final.
    for (const run of rm.list().filter((r) => r.taskId === id && r.status === "running")) rm.stop(run.runId);
    const sid = getTaskSession(db, id).sessionId;
    sessionLauncher.stop?.(sid ?? "");
    // Reflect the stop and prevent anything from auto-resuming it (the rate-limit
    // auto-fallback only acts on a "rate_limit" reason, so "stopped" is skipped).
    if (getTask(db, id)?.status !== "done") updateTaskStatus(db, id, "waiting");
    saveResult(id, "advance", "stop-reason", { kind: "stopped" });
    recordTurn(id, "advance", "Stopped", "Stopped by the user.");
    return c.json({ ok: true });
  });

  // Switch the subscription a task runs under. Body: { profile, resume? }.
  //  - resume omitted/true: mid-session switch — stop the live process, repoint
  //    the profile, then resume (--resume) under it with a "Continue" nudge
  //    (streams; returns { runId }). For the limits flow / a running task.
  //  - resume:false: just pin the profile for the next run, no agent run
  //    (returns { ok }). For changing the account on an idle task.
  app.post("/api/tasks/:id/switch-profile", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { profile?: unknown; resume?: unknown };
    const profile = typeof body.profile === "string" ? body.profile.trim() : "";
    if (!profile) return c.json({ error: "profile required" }, 400);
    const resume = body.resume !== false;
    const sid = getTaskSession(db, id).sessionId;
    // Kill any live process so the next send respawns under the new profile.
    sessionLauncher.stop?.(sid ?? "");
    setTaskProfile(db, id, profile);
    // Move the session transcript into the new profile's config dir so `--resume`
    // continues the SAME conversation under the new account (not the old, rate-
    // limited one). Then clear the stale rate-limit banner.
    if (sid) relocateSessionForProfile(profile, sid);
    saveResult(id, "advance", "stop-reason", { kind: "none" });
    if (!resume) return c.json({ ok: true });
    const projectId = projectActive()?.projectId ?? "default";
    const isAutopilot = getTask(db, id)?.run_mode === "autopilot";
    const runId = rm.start({ projectId, taskId: id }, async (ctx) => {
      streamSinks.set(id, ctx.appendOutput);
      ctx.onInput((data) => { const s = getTaskSession(db, id).sessionId; if (s) sessionLauncher.interject?.(s, data); });
      try {
        if (isAutopilot) {
          // Autopilot means run end-to-end — after an account switch, continue the
          // PIPELINE under the new subscription (the session was relocated so the
          // agent keeps its context), not just a one-shot chat that then needs a
          // manual Advance.
          updateTaskStatus(db, id, "running");
          const res = await advanceTask(db, id, runners, advanceOpts());
          if (res.reason?.kind === "rate_limit") {
            const reset = res.reason.resetsAt ? ` (resets ${res.reason.resetsAt})` : "";
            recordTurn(id, res.stoppedAt ?? "advance", "Rate limit", `Run stopped: ${res.reason.profile ?? "the subscription"} hit its rate limit${reset}. Switch account or wait, then continue.`);
          }
          if (res.stoppedAt && getTask(db, id)?.status !== "done") updateTaskStatus(db, id, "waiting");
          return { outcome: { ok: true }, stoppedAt: res.stoppedAt, reason: res.reason };
        }
        // manual/gated: raw resume of the same conversation under the new subscription
        await sessionSend(id, "chat", "Continue — продолжай с того места, где остановился.", { raw: true });
        return { outcome: { ok: true } };
      } finally {
        streamSinks.delete(id);
      }
    });
    return c.json({ runId });
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
    const key = c.req.param("key");
    // Validate the stage belongs to this task — else completeStage is a silent
    // no-op that still returns ok (loom-1c75).
    if (!getStages(db, id).some((s) => s.stage_key === key)) return c.json({ error: "unknown stage" }, 400);
    const next = completeStage(db, id, key);
    return c.json({ next });
  });

  // Toggle a stage's gate. Body: { gate: boolean }.
  app.post("/api/tasks/:id/stages/:key/gate", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { gate?: unknown };
    const key = c.req.param("key");
    if (!getStages(db, id).some((s) => s.stage_key === key)) return c.json({ error: "unknown stage" }, 400);
    setStageGate(db, id, key, body.gate !== false);
    return c.json({ ok: true });
  });

  // Move a task to a stage (board drag-drop). Body: { stageKey, run? }.
  // Repositions the task; with run:true it also starts the dropped stage right
  // away in the task's ONE session (prior stages' context already lives there —
  // that's how "results of previous steps" carry over). run omitted = move only.
  app.post("/api/tasks/:id/move", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { stageKey?: unknown; run?: unknown };
    const stageKey = typeof body.stageKey === "string" ? body.stageKey : "";
    const current = moveToStage(db, id, stageKey);
    if (current === null && stageKey !== "done") return c.json({ error: "unknown stage" }, 400);
    const runId = body.run === true ? startRun(id, stageKey) : undefined;
    return c.json({ current, runId });
  });

  // Free-form chat with the task's agent at ANY stage. The message goes verbatim
  // into the task's ONE session (raw — no stage wrapper), so the user can answer
  // the agent's questions or redirect it. Streams the reply into the transcript
  // (→ SSE) and records it as a turn. Body: { message, stage? }. Returns runId.
  app.post("/api/tasks/:id/chat", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { message?: unknown; stage?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return c.json({ error: "message required" }, 400);
    const stage = typeof body.stage === "string" && body.stage ? body.stage : "chat";
    const projectId = projectActive()?.projectId ?? "default";
    const runId = rm.start({ projectId, taskId: id }, async (ctx) => {
      streamSinks.set(id, ctx.appendOutput);
      ctx.onInput((data) => {
        const sid = getTaskSession(db, id).sessionId;
        if (sid) sessionLauncher.interject?.(sid, data);
      });
      try {
        const text = await sessionSend(id, stage, message, { raw: true });
        return { outcome: { ok: true }, text };
      } finally {
        streamSinks.delete(id);
      }
    });
    return c.json({ runId });
  });

  // ─── module actions (F1.5) ────────────────────────────────────────────────

  // Re-check account health (re-loads the workspace). Returns the health slice.
  app.post("/api/accounts/health", async (c) => {
    const ws = await loadWorkspace();
    return c.json({ health: ws.health });
  });

  // Live rate-limit utilization for OAuth profiles (aimux probe). ?profile=<name>
  // for one (used by a task to watch its own subscription), else all. Non-oauth
  // profiles return nothing (no probe). Each probe is a ~5s-timeout network call.
  // Rate-limit lookups spawn a per-profile CLI call — expensive. Cache per
  // profile with a short TTL so the UI's polling never stacks slow spawns (which
  // would exhaust the browser's per-host connection pool and freeze the page).
  // A single in-flight promise per profile coalesces concurrent requests.
  const limitsCache = new Map<string, { at: number; value: unknown; inflight?: Promise<unknown> }>();
  // Override the cached probe for a profile that just hit a real rate limit, so
  // the Accounts view and auto-fallback see it as rejected rather than trusting a
  // lagging "allowed" reading.
  function markProfileRateLimited(profile: string): void {
    const prev = (limitsCache.get(profile)?.value ?? null) as Record<string, unknown> | null;
    limitsCache.set(profile, { at: Date.now(), value: { ...(prev ?? {}), profile, status: "rejected", fiveHourPct: 100 } });
  }
  const LIMITS_TTL = 60_000;
  const limitsFor = async (name: string, cfg: ReturnType<typeof loadConfig>): Promise<unknown> => {
    const now = Date.now();
    const hit = limitsCache.get(name);
    if (hit && now - hit.at < LIMITS_TTL) return hit.value;
    if (hit?.inflight) return hit.inflight; // coalesce concurrent callers
    const p = cfg!.profiles[name];
    const inflight = fetchRateLimits(p, expandHome(p.path))
      .then((status) => {
        const value = status ? { profile: name, ...status } : null;
        limitsCache.set(name, { at: Date.now(), value });
        return value;
      })
      .catch(() => {
        limitsCache.set(name, { at: Date.now(), value: hit?.value ?? null }); // keep last good
        return hit?.value ?? null;
      });
    limitsCache.set(name, { at: hit?.at ?? 0, value: hit?.value ?? null, inflight });
    return inflight;
  };
  app.get("/api/accounts/limits", async (c) => {
    const want = c.req.query("profile");
    const cfg = loadConfig();
    if (!cfg) return c.json({ limits: [] });
    const names = want ? (cfg.profiles[want] ? [want] : []) : Object.keys(cfg.profiles);
    const limits = await Promise.all(names.map((name) => limitsFor(name, cfg)));
    return c.json({ limits: limits.filter(Boolean) });
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

  // Remove an aimux subscription (non-source only). Body: { name }.
  app.post("/api/accounts/subscription/remove", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    if (typeof b.name !== "string" || !b.name) return c.json({ error: "name required" }, 400);
    const res = removeSubscription(b.name);
    return res.ok ? c.json(res) : c.json(res, 400);
  });

  // In-UI profile authorization (aimux auth login via a PTY). Start → poll status
  // (returns the OAuth URL once it appears) → submit the pasted code. On success
  // the CLI writes the profile's credentials → status "done".
  app.post("/api/accounts/:name/auth/start", (c) => {
    try {
      return c.json({ authId: authMgr.start(c.req.param("name")) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.get("/api/accounts/auth/:authId", (c) => {
    const v = authMgr.get(c.req.param("authId"));
    return v ? c.json(v) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/accounts/auth/:authId/code", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { code?: unknown };
    const code = typeof b.code === "string" ? b.code : "";
    if (!code) return c.json({ error: "code required" }, 400);
    return authMgr.submitCode(c.req.param("authId"), code) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  // task-journal task detail (decisions/findings/rejections) for the Memory drill-in.
  app.get("/api/memory/tasks/:id", (c) => c.json({ detail: memoryTask(c.req.param("id")) }));
  // A board task's history dossier — the agent's task-journal reasoning, read
  // from the worktree project it ran in (live), falling back to the snapshot
  // captured at Done so it survives the worktree's deletion.
  app.get("/api/tasks/:id/dossier", async (c) => {
    const id = c.req.param("id");
    const t = getTask(db, id);
    const pack = boardJournalPack(id);
    // Best-effort git diff --stat of the task's branch; "" (no Changes section)
    // when the task has no repo, the branch doesn't exist yet, or git is absent.
    let diff = t?.repo ? await diffSummary(realSh, t.repo, t.branch ?? await defaultBranch(realSh, t.repo), worktreeBranch(id)) : "";
    if (!diff.trim()) diff = loadResult<{ diff?: string }>(id, DIFF_SNAPSHOT_KIND)?.diff ?? ""; // branch merged+deleted → stored snapshot
    return c.json({
      pack: renderDossier({
        pack,
        stages: getStages(db, id),
        costs: getCosts(db, id),
        attachments: getAttachments(db, id),
        diff,
      }),
    });
  });
  // task-journal's own readable dossier (its `pack` render) as Markdown.
  app.get("/api/memory/tasks/:id/pack", (c) =>
    c.json({ pack: taskPack(resolveProjectRoot(projectActive()?.root ?? process.cwd()), c.req.param("id")) }),
  );
  // Memory drill-in for a BOARD task: the agent's reasoning journal for t-<id>
  // (live from its worktree project, snapshot fallback) — no pipeline/cost noise.
  app.get("/api/memory/board/:id", (c) => c.json({ pack: boardJournalPack(c.req.param("id")) }));

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

  // ─── conductor (L13) ──────────────────────────────────────────────────────────
  // Drive the task per run_mode (manual parks, gated stops at gate=1, autopilot
  // runs through). run-stage runs the current stage (manual Run / gate approval).
  // Auto-run forward per run_mode (gated stops at gates, autopilot runs through).
  // Streamed via the run-manager so automatic mode shows live progress and can be
  // reconnected to — returns { runId } immediately.
  app.post("/api/tasks/:id/advance", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const projectId = projectActive()?.projectId ?? "default";
    const runId = rm.start({ projectId, taskId: id }, async (ctx) => {
      streamSinks.set(id, ctx.appendOutput);
      updateTaskStatus(db, id, "running"); // live while the pipeline advances
      ctx.onInput((data) => {
        const sid = getTaskSession(db, id).sessionId;
        if (sid) sessionLauncher.interject?.(sid, data);
      });
      try {
        const res = await advanceTask(db, id, runners, advanceOpts());
        if (res.reason?.kind === "cost_cap") {
          saveResult(id, res.stoppedAt ?? "advance", "stop-reason", res.reason); // surfaced as a banner
          recordTurn(id, res.stoppedAt ?? "advance", "Cost cap", `Run stopped: cost limit $${res.reason.cap} reached (spent $${res.reason.spent?.toFixed(2)}).`);
        } else if (res.reason?.kind === "rate_limit") {
          // The stage wrapper already persisted the rate_limit stop-reason (banner);
          // record a turn so the transcript explains why autopilot paused.
          const reset = res.reason.resetsAt ? ` (resets ${res.reason.resetsAt})` : "";
          recordTurn(id, res.stoppedAt ?? "advance", "Rate limit", `Run stopped: ${res.reason.profile ?? "the subscription"} hit its rate limit${reset}. Switch account or wait, then continue.`);
        }
        // Parked (not done) → reflect "waiting / needs you", not a misleading "running".
        if (res.stoppedAt && getTask(db, id)?.status !== "done") updateTaskStatus(db, id, "waiting");
        return { outcome: { ok: true }, ran: res.ran, stoppedAt: res.stoppedAt, reason: res.reason };
      } finally {
        streamSinks.delete(id);
      }
    });
    return c.json({ runId });
  });
  app.post("/api/tasks/:id/run-stage", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    updateTaskStatus(db, id, "running");
    const res = await runAndAdvance(db, id, runners, advanceOpts());
    // Parked (not done) → "waiting / needs you" instead of a misleading "running".
    if (res.stoppedAt && getTask(db, id)?.status !== "done") updateTaskStatus(db, id, "waiting");
    return c.json(res);
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
        // No base → runPr detects the repo's default branch (origin/HEAD).
        // (t.branch is the task's HEAD branch, never the PR base.)
        base: typeof body.base === "string" ? body.base : opts.base,
        sh: opts.sh ?? realSh,
      };
    }
    const pr = await runPr(db, id, opts);
    saveResult(id, "pr", "pr-result", pr); // visible in the PR result card + on revisit
    const status = pr.pushed
      ? `\n\n✅ Branch pushed.${pr.compareUrl ? ` Open a PR: ${pr.compareUrl}` : " Open a PR on your host."}`
      : pr.error ? `\n\n⚠️ Push failed: ${pr.error}` : "";
    recordTurn(id, "pr", pr.connector ? "Push & PR link" : "Generate the PR description", pr.description + status);
    // We push the branch and hand back a link; the user opens the PR on their
    // forge and merges there — Loom can't know when that lands, so the task stays
    // parked at PR (not auto-finalized) until the user marks it done.
    return c.json({ pr, done: pr.created });
  });

  // ─── filesystem browse (folder pickers) ───────────────────────────────────────
  app.get("/api/fs/list", (c) => c.json(browseDir(c.req.query("path"))));
  app.post("/api/tasks/:id/done/run", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    runDone(db, id, { projectId: resolveProjectId(c), closeTask: () => deps.closeTask?.(id) });
    snapshotJournal(id); // after close: capture the full reasoning (incl. outcome) before worktree cleanup
    await snapshotDiff(id); // freeze the git diff --stat before the branch is merged + deleted
    recordTurn(id, "done", "Finalize the task", "Task finished and closed.");
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
    // brainstormTurn runs through the task session (sessionSend), which already
    // records the exchange as a transcript turn — no extra recordTurn needed.
    return c.json({ question: await brainstormTurn(db, id, stageAgentFor(id, "brainstorm"), message) });
  });
  app.post("/api/tasks/:id/brainstorm/done", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const summary = await summarizeBrainstorm(db, id, stageAgentFor(id, "brainstorm"));
    const next = completeStage(db, id, "brainstorm"); // "Done → Spec" advances to the spec stage
    return c.json({ summary, next });
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
  app.get("/api/connectors/mcp", (c) => c.json({ servers: runtime.connectors.listMcp() }));
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
  app.post("/api/connectors/mcp/:id/test", (c) => c.json(testMcp(c.req.param("id"), { probe: deps.mcpProbe ?? realMcpProbe })));
  // D5.4/5.5 — import open tracker items as tasks on the board.
  app.post("/api/connectors/import", (c) => {
    // Call importDrafts AS A METHOD (not a torn-off reference) so a future
    // AgentRuntime whose connectors rely on `this` keeps its binding.
    const drafts = deps.importDrafts ? deps.importDrafts() : runtime.connectors.importDrafts();
    let created = 0;
    let skipped = 0;
    for (const d of drafts) {
      // Idempotent: a draft already imported (same external item) is skipped so
      // re-running import never duplicates tasks. Drafts without an external id
      // are created as before.
      if (d.externalId && findTaskByExternalRef(db, d.externalId)) {
        skipped += 1;
        continue;
      }
      createTask(db, { id: `t-${randomUUID().slice(0, 8)}`, title: d.title, description: d.description, externalRef: d.externalId });
      created += 1;
    }
    return c.json({ created, skipped });
  });

  // ─── settings / attachments (D6) ──────────────────────────────────────────────
  app.get("/api/settings", (c) => c.json(getAllSettings(db)));
  app.post("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
    if (typeof body.key !== "string") return c.json({ error: "key required" }, 400);
    setSetting(db, body.key, body.value);
    return c.json({ ok: true });
  });

  // Security configuration — view/edit the command policy (allow/deny) and the
  // secret-scan rules, plus the secret-scan on/off switch. Built-in defaults
  // are returned read-only; user patterns are validated before they persist.
  app.get("/api/security/policy", (c) => {
    const cfg = loadSecurityConfig(db);
    return c.json({
      defaults: { deny: defaultDenySources() },
      allow: cfg.allow,
      deny: cfg.deny,
      summary: policySummary(cfg),
    });
  });
  app.post("/api/security/policy", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { allow?: unknown; deny?: unknown };
    if (body.allow !== undefined && !Array.isArray(body.allow)) return c.json({ error: "allow must be an array" }, 400);
    if (body.deny !== undefined && !Array.isArray(body.deny)) return c.json({ error: "deny must be an array" }, 400);
    const r = saveCommandPolicy(db, body.allow ?? [], body.deny ?? []);
    if (!r.ok) return c.json({ error: r.error }, 400);
    return c.json({ ok: true, summary: policySummary(loadSecurityConfig(db)) });
  });
  app.get("/api/security/secrets", (c) => {
    const cfg = loadSecurityConfig(db);
    return c.json({
      defaults: DEFAULT_SECRET_KINDS,
      custom: cfg.secretRules,
      enabled: cfg.secretScanEnabled,
    });
  });
  app.post("/api/security/secrets", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { custom?: unknown; enabled?: unknown };
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return c.json({ error: "enabled must be a boolean" }, 400);
    if (body.custom !== undefined && !Array.isArray(body.custom)) return c.json({ error: "custom must be an array" }, 400);
    const cfg = loadSecurityConfig(db);
    const enabled = body.enabled === undefined ? cfg.secretScanEnabled : body.enabled;
    const rules = body.custom === undefined ? cfg.secretRules : body.custom;
    const r = saveSecretConfig(db, rules, enabled);
    if (!r.ok) return c.json({ error: r.error }, 400);
    const next = loadSecurityConfig(db);
    return c.json({ ok: true, enabled: next.secretScanEnabled, custom: next.secretRules });
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
  // The FULL layer architecture (Bible §2): 3 standalone plugins + the inline
  // layers in core/* that become standalone in Phase 2. For standalone layers we
  // merge the registered plugin's capabilities (execute/slots) so the view shows
  // both the roadmap status and what each layer actually contributes.
  app.get("/api/layers", (c) => {
    const plugins = new Map(loomRegistry.list().map((p) => [p.id, p]));
    return c.json({
      layers: LAYER_CATALOG.map((l) => {
        const p = l.plugin ? plugins.get(l.plugin) : undefined;
        return {
          id: l.id,
          title: l.label,
          node: l.node,
          status: l.status,
          source: l.source,
          description: l.description,
          executes: p ? typeof p.execute === "function" : false,
          slots: p?.slots ?? [],
        };
      }),
    });
  });
  // Skills library — browse / read / edit / AI-generate skills from ~/.claude/skills.
  app.get("/api/skills", (c) => c.json({ skills: runtime.skills.list() }));
  app.get("/api/skills/:name", (c) => {
    const content = runtime.skills.read(c.req.param("name"));
    return content === null ? c.json({ error: "not found" }, 404) : c.json({ name: c.req.param("name"), content });
  });
  app.put("/api/skills/:name", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { content?: unknown };
    if (typeof body.content !== "string") return c.json({ error: "content required" }, 400);
    return runtime.skills.write(c.req.param("name"), body.content) ? c.json({ ok: true }) : c.json({ error: "invalid name" }, 400);
  });
  app.delete("/api/skills/:name", (c) => {
    const name = c.req.param("name");
    // Reject a bad name up front so the two failure modes stay distinct:
    // 400 invalid name vs 404 the skill doesn't exist.
    if (!isValidSkillName(name)) return c.json({ error: "invalid name" }, 400);
    return runtime.skills.delete(name) ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
  app.post("/api/skills/generate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { description?: unknown; profile?: unknown };
    const description = typeof body.description === "string" ? body.description : "";
    if (!description.trim()) return c.json({ error: "description required" }, 400);
    const profile = typeof body.profile === "string" ? body.profile : undefined;
    const agent = deps.skillAgent ?? createAimuxStageAgent({ profile });
    const r = await runtime.skills.generate(description, agent);
    return r ? c.json(r) : c.json({ error: "generation produced no valid skill" }, 422);
  });

  // ─── quality: review / qa (L6) ────────────────────────────────────────────────
  app.get("/api/flow-config/:stage", (c) => {
    const stage = c.req.param("stage");
    if (stage === "review") return c.json({ passes: resolvedReviewerKeys() });
    return c.json({ passes: resolveFlow(stage, storedFlow(stage)) });
  });
  // Persist the editable flow config (Quality view). Empty array → back to defaults.
  app.post("/api/flow-config/:stage", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { passes?: unknown };
    if (!Array.isArray(body.passes)) return c.json({ error: "passes[] required" }, 400);
    setSetting(db, `flow.${c.req.param("stage")}`, body.passes.filter((p): p is string => typeof p === "string").slice(0, 64));
    return c.json({ ok: true });
  });
  // Run the NEXT reviewer in the pipeline (or a specific one via {reviewer}).
  // This is the "approve & run next" action: running ralph/adversarial implies
  // the previous reviewer was approved. Findings accumulate; the response's
  // `next` is the reviewer still to run (null when all three are done → Fix all).
  app.post("/api/tasks/:id/review/run", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { reviewer?: unknown };
    const active = resolvedReviewerKeys();
    const prev = loadResult<ReviewPayload>(id, "review-result");
    const done = new Set(prev?.reviewersDone ?? []);
    const explicit = typeof body.reviewer === "string" && active.includes(body.reviewer) ? body.reviewer : undefined;
    const key = explicit ?? active.find((k) => !done.has(k));
    if (!key) return c.json({ error: "all reviewers done" }, 400);
    const reviewer = REVIEWERS.find((r) => r.key === key)!;
    const findings = await runReviewer(id, reviewer);
    // First active reviewer with no prior progress starts a fresh pipeline.
    const reset = key === active[0] && done.size === 0;
    const payload = recordReviewer(id, key, findings, { reset });
    recordTurn(id, "review", `Review — ${reviewer.label}`, fmtReview(payload.result));
    const doneSet = new Set(payload.reviewersDone);
    const next = active.find((k) => !doneSet.has(k)) ?? null;
    return c.json({ ...payload, ran: key, next });
  });
  // Fix the findings from the last review. The fix IS implementation work, so the
  // task moves back to the implementation stage while the agent fixes (board shows
  // it there), then we re-review and move back to review. Streams into the
  // transcript (→ SSE); stops on review for the user to approve. Returns { runId }.
  app.post("/api/tasks/:id/review/fix", (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const stored = loadResult<{ result: { findings: { severity: string; message: string; file?: string }[] } }>(id, "review-result");
    const findings = stored?.result?.findings ?? [];
    if (!findings.length) return c.json({ error: "no findings to fix" }, 400);
    const projectId = projectActive()?.projectId ?? "default";
    const runId = rm.start({ projectId, taskId: id }, async (ctx) => {
      streamSinks.set(id, ctx.appendOutput);
      try {
        moveToStage(db, id, "impl"); // back to implementation: the card shows the fix is dev work
        await fixAllFindings(id, findings as Finding[]); // fix every accumulated finding at once
        // Re-review (fresh "self" pass) verifying the prior findings; the user can
        // re-run ralph / adversarial afterwards for another full sweep.
        const payload = await reReviewAfterFix(id, findings as Finding[]);
        recordTurn(id, "review", "Re-review after fixes", fmtReview(payload.result));
        moveToStage(db, id, "review"); // back to review for the user to see the result + approve
        return { outcome: { ok: payload.result.passed } };
      } finally {
        streamSinks.delete(id);
      }
    });
    return c.json({ runId });
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
  // Latest PR result (description + pushed/compareUrl/error) for the PR result card.
  app.get("/api/tasks/:id/pr", (c) => {
    const stored = loadResult<{ description: string; created: boolean; pushed?: boolean; compareUrl?: string; url?: string; connector: boolean; error?: string }>(c.req.param("id"), "pr-result");
    return c.json({ pr: stored });
  });
  // Can the connector push for this task (just an origin remote — we push the
  // branch and return a host PR/MR link, no gh, so any forge works)? Drives the
  // "push + PR link" affordance so the user knows before clicking.
  app.get("/api/tasks/:id/pr/connector", async (c) => {
    const t = getTask(db, c.req.param("id"));
    if (!t?.repo) return c.json({ remote: false, repo: false });
    return c.json({ ...(await prConnectorStatus(realSh, t.repo)), repo: true });
  });
  // Stored stage results (history re-display when revisiting a completed stage).
  app.get("/api/tasks/:id/analysis", (c) => {
    const a = latestArtifact(db, c.req.param("id"), "analysis");
    const text = a?.content ?? null; // the agent's full readable analysis
    return c.json({ result: text ? parseAnalysis(text) : null, text });
  });
  // Full session transcript: every turn (stage + input + the agent's output),
  // in order — the live conversation of the task's one session.
  app.get("/api/tasks/:id/transcript", (c) => {
    const turns = getArtifacts(db, c.req.param("id"))
      .filter((a) => a.kind === "turn")
      .map((a) => {
        let d: { input?: string; output?: string } = {};
        try { d = JSON.parse(a.content); } catch { /* skip */ }
        return { stage: a.stage, input: d.input ?? "", output: d.output ?? "" };
      });
    return c.json({ turns });
  });
  // Read a file the agent produced/touched, for the in-app viewer. Restricted to
  // the task's own roots (worktree + repo) — no path traversal, no arbitrary FS.
  app.get("/api/tasks/:id/file", (c) => {
    const id = c.req.param("id");
    const t = getTask(db, id);
    if (!t) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    if (!rel) return c.json({ error: "path required" }, 400);
    const roots = [taskCwd(id), t.repo].filter((r): r is string => !!r);
    const abs = roots.length ? safeResolveAny(roots, rel) : null;
    // lexical check, then resolve symlinks and re-verify containment so a symlink
    // planted in the repo can't read a file outside it.
    const real = abs ? realContained(roots, abs) : null;
    if (!real) {
      // `abs` is lexically inside a root but realContained failed. Distinguish a
      // file that simply isn't there (e.g. an unbuilt artifact like dist/cli.js)
      // from a real escape, so the viewer shows "not found" (404) instead of a
      // misleading "outside the task" (403). Never reads — safe.
      if (abs && !existsSync(abs)) return c.json({ error: "file not found in the task's working tree" }, 404);
      return c.json({ error: "path outside the task" }, 403);
    }
    try {
      const st = statSync(real);
      if (!st.isFile()) return c.json({ error: "not a file" }, 400);
      if (st.size > 512_000) return c.json({ error: "file too large to preview" }, 413);
      return c.json({ path: rel, content: readFileSync(real, "utf8") });
    } catch {
      return c.json({ error: "cannot read file" }, 404);
    }
  });
  // Unified git diff of the task's work (whole worktree, or one file with ?path=)
  // vs its base branch — for the in-app colored diff viewer.
  app.get("/api/tasks/:id/diff", async (c) => {
    const id = c.req.param("id");
    const t = getTask(db, id);
    if (!t) return c.json({ error: "not found" }, 404);
    const wt = taskCwd(id);
    if (!wt || !isGitRepo(wt)) return c.json({ diff: "", base: null });
    const exists = async (ref: string) => (await realSh("git", ["rev-parse", "--verify", "--quiet", ref], wt)).code === 0;
    let base: string | null = null;
    for (const r of [t.branch, "master", "main"]) { if (r && (await exists(r))) { base = r; break; } }
    const rel = c.req.query("path");
    const safeRel = typeof rel === "string" && rel && safeResolveAny([wt, t.repo].filter((r): r is string => !!r), rel) ? rel : undefined;
    const args = ["diff", ...(base ? [base] : []), ...(safeRel ? ["--", safeRel] : [])];
    const out = (await realSh("git", args, wt)).stdout;
    const diff = out.length > 400_000 ? `${out.slice(0, 400_000)}\n… (diff truncated)` : out;
    return c.json({ diff, base });
  });
  app.get("/api/tasks/:id/review", (c) => c.json(loadResult(c.req.param("id"), "review-result") ?? { result: null }));
  app.get("/api/tasks/:id/qa", (c) => c.json(loadResult(c.req.param("id"), "qa-result") ?? { result: null }));
  app.get("/api/tasks/:id/rd", (c) => c.json(loadResult(c.req.param("id"), "rd-plan") ?? { plan: null }));
  app.get("/api/tasks/:id/impl", (c) => c.json(loadResult(c.req.param("id"), "impl-report") ?? { report: null }));

  // ─── permissions (deny → approve) ─────────────────────────────────────────────
  // Tools the agent was denied (await approval) + the task's current allowlist.
  app.get("/api/tasks/:id/permissions", (c) => {
    const id = c.req.param("id");
    const denied = loadResult<{ denials: string[] }>(id, "permission-denials")?.denials ?? [];
    const allowed = taskAllowed(id);
    return c.json({ denials: denied.filter((d) => !allowed.includes(d)), allowed });
  });
  // Approve a tool: add it to the task's allowlist (next run includes it). Body: { tool }.
  app.post("/api/tasks/:id/permissions/allow", async (c) => {
    const id = c.req.param("id");
    if (!getTask(db, id)) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { tool?: unknown };
    const tool = typeof body.tool === "string" ? body.tool.trim() : "";
    // strict shape (e.g. "Read", "Bash(git *)", "mcp__plugin_task-journal__event_add")
    // — must start with a letter (never a "--flag" argv smuggle) and carry no
    // comma (which would inject extra entries into the --allowedTools csv).
    if (!/^[A-Za-z][A-Za-z0-9_.-]*(\([^),\n]*\))?$/.test(tool)) return c.json({ error: "invalid tool" }, 400);
    const allowed = taskAllowed(id);
    if (!allowed.includes(tool)) setSetting(db, allowKey(id), [...allowed, tool]);
    return c.json({ allowed: taskAllowed(id) });
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

  // The task's currently-running run, if any — so returning to a task (reload,
  // navigation) reconnects to the live stream instead of losing it.
  app.get("/api/tasks/:id/active-run", (c) => {
    const id = c.req.param("id");
    const run = rm.list().find((r) => r.taskId === id && r.status === "running");
    return c.json({ runId: run?.runId ?? null });
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
      let outCursor = 0;
      // Stream until the run settles (or the client disconnects). Output starts at
      // 0, so a client that (re)connects mid-run replays the whole buffer — this
      // is how returning to a task picks the live run back up.
      for (;;) {
        const rec = rm.get(runId);
        if (!rec) {
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "unknown run" }) });
          return;
        }
        while (outCursor < rec.output.length) {
          await stream.writeSSE({ event: "event", data: rec.output[outCursor] }); // agent's streamed text/tool activity
          outCursor += 1;
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

  // ── Auto-fallback: when a task is parked on a rate limit and the user doesn't
  // pick a replacement within the grace window, switch to the next subscription
  // that still has headroom and continue the SAME session there. The server runs
  // this on a timer (see server.ts). Profile names come from the live config —
  // never hardcoded — and if nothing healthy exists the task stays parked.
  function performProfileSwitch(id: string, profile: string): void {
    const sid = getTaskSession(db, id).sessionId;
    sessionLauncher.stop?.(sid ?? "");
    setTaskProfile(db, id, profile);
    if (sid) relocateSessionForProfile(profile, sid);
    saveResult(id, "advance", "stop-reason", { kind: "none" });
    const projectId = projectActive()?.projectId ?? "default";
    rm.start({ projectId, taskId: id }, async (ctx) => {
      streamSinks.set(id, ctx.appendOutput);
      try {
        updateTaskStatus(db, id, "running");
        const res = await advanceTask(db, id, runners, advanceOpts());
        if (res.stoppedAt && getTask(db, id)?.status !== "done") updateTaskStatus(db, id, "waiting");
        return { outcome: { ok: true }, stoppedAt: res.stoppedAt, reason: res.reason };
      } finally {
        streamSinks.delete(id);
      }
    });
  }

  async function autoFallbackTick(): Promise<void> {
    const cfg = loadConfig();
    if (!cfg) return;
    const now = Date.now();
    for (const t of listTasks(db)) {
      if (t.status !== "waiting") continue;
      const stop = loadResult<{ kind: string; profile?: string | null }>(t.id, "stop-reason");
      if (stop?.kind !== "rate_limit") continue;
      if (!shouldAutoFallback(t.updated_at, now)) continue;
      const current = stop.profile ?? t.profile ?? "";
      const limits = (await Promise.all(Object.keys(cfg.profiles).map((n) => limitsFor(n, cfg)))).filter(Boolean) as ProfileLimit[];
      const next = pickFallbackProfile(limits, current);
      if (!next) continue; // no healthy alternative → stay parked, honest
      recordTurn(t.id, "advance", "Auto-fallback", `No account chosen within the grace window — switching to "${next}" (has headroom) and continuing.`);
      performProfileSwitch(t.id, next);
    }
  }
  (app as Hono & { autoFallbackTick?: () => Promise<void> }).autoFallbackTick = autoFallbackTick;

  return app;
}
