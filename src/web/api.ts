// Local HTTP API over the core store — the backend the React web-UI (and the
// Tauri sidecar) talk to. Read endpoints first; mutations land in later slices.
// The db is injected so the API is testable with a seeded in-memory store.

import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { listTasks, getTask, getStages, createTask, deleteTask, setStageGate, getTaskSession, getLaneSessionIds, setTaskProfile, updateTaskStatus, findTaskByExternalRef } from "../core/store/db.js";
import { getSteps } from "../core/store/steps.js";
import { getCosts, insertRun, completeRun, reconcileInterruptedRuns } from "../core/store/execute.js";
import { DEGRADED_KIND } from "../core/store/degraded.js";
import { boardColumns, attentionQueue, startTask, completeStage, moveToStage } from "../core/pipeline/engine.js";
import { STAGE_MODEL, MODEL_TIERS, resolveStageModel } from "../core/pipeline/stage-model.js";
import { loadWorkspaceData, type WorkspaceData } from "../core/data/loader.js";
import { resolveProjectRoot, deriveProjectId } from "../core/workspace/project-id.js";
import { taskDetail, taskPack, boardTaskJournal, boardTaskStory, exportEventsSafe, renderJournalFromEvents, bindExternal, openTask, tasksFromEvents, type TjEvent } from "../core/plugins/task-journal/adapter.js";
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
import { tokenEventsByTime, tokenUsageBySession, toolCallTokensForSessions, toolCallUsageBySession } from "../core/plugins/token-pilot/adapter.js";
import { listSessions } from "../core/plugins/aimux/adapter.js";
import { loadLoomEvents, loadCommandAuditEvents } from "../core/spine/event-bus.js";
import type { LoomEvent } from "../core/spine/event.js";
import { boardTotals, agentPerformance, failureReasons } from "../core/observability/metrics.js";
import { recallPrior, partitionHits, askSearch, type RecallHit } from "../core/knowledge/recall.js";
import {
  runAnalysis,
  brainstormTurn,
  summarizeBrainstorm,
  runAutoBrainstorm,
  draftSpec,
  reviseSpec,
  acceptSpec,
  parseAnalysis,
  type StageAgent,
} from "../core/pipeline/stage-runners.js";
import { createAimuxStageAgent } from "../core/pipeline/stage-agent.js";
import { createTaskSession, parseCompleteness, declaresRemainingWork, detectRateLimit, languageDirective, type SessionLauncher } from "../core/automation/task-session.js";
import type { SessionControl } from "../core/automation/live-session.js";
import { createClaudeRuntime } from "../core/runtime/claude-runtime.js";
import type { AgentRuntime } from "../core/runtime/agent-runtime.js";
import { getChatMessages, latestArtifact, createArtifact, getArtifacts } from "../core/store/artifacts.js";
import { runPr, runDone, prConnectorStatus, defaultBranch, type PrOptions, type Sh } from "../core/pipeline/pr-done.js";
import { buildQaChecks } from "../core/quality/default-qa-checks.js";
import { commitWorktree, rebaseWorktreeOnBase } from "../core/automation/auto-commit.js";
import { worktreeBranch, ensureWorktree, worktreePath, removeWorktree, securityDataDir, prepareSwarmWorktree, removeSwarmWorktree, swarmWorktreePath, type GitRunner } from "../core/security/sandbox.js";
import { resolveSwarmConfig, type StageSwarmConfig } from "../core/layers/swarm/config.js";
import { runImplSwarm } from "../core/layers/swarm/impl-swarm.js";
import { perspectivePrompt } from "../core/layers/swarm/discrete-swarm.js";
import { swarmRunEvent, sumAttemptCost } from "../core/layers/swarm/events.js";
import { appendLoomEvent } from "../core/spine/event-bus.js";
import { SESSION_PREAMBLE, TOOLS_ANCHOR, stageInstruction } from "../core/automation/task-session.js";
import { browseDir } from "../core/workspace/fs-browse.js";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { safeResolveAny, realContained } from "../core/security/path-safety.js";
import { audit } from "../core/security/audit.js";
import { DEFAULT_EGRESS_ALLOW } from "../core/security/egress-allowlist.js";
import { join as pathJoin, isAbsolute, dirname, resolve as pathResolve } from "node:path";
import { advanceTask, runAndAdvance, type RunnerRegistry, type AdvanceOptions } from "../core/pipeline/conductor.js";
import { parseRelocate, relocateAllowed, type Relocate } from "../core/pipeline/relocate.js";
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
  redactWithCustom,
  writeCommandPolicyFile,
  DEFAULT_SECRET_KINDS,
} from "../core/security/policy-config.js";
import { addAttachment, getAttachments, attachmentsPrompt } from "../core/store/attachments.js";
import { addMcp, toggleMcp, removeMcp, testMcp, type McpProbe } from "../core/connectors/mcp.js";
import type { TaskDraft } from "../core/connectors/connector.js";
import { CONNECTORS } from "../core/connectors/registry.js";
import type { ImportOptions } from "../core/runtime/agent-runtime.js";
import { resolveFlow } from "../core/quality/flow-config.js";
import { isValidSkillName } from "../core/skills/skills.js";
import { reviewAction, reviewHolds, type ReviewAction } from "../core/quality/review-runner.js";
import { runQa, type QaCheck } from "../core/quality/qa-runner.js";
import { resolveQaMode } from "../core/quality/qa-mode.js";
import { reviewPrompt, parseFindings, aggregateFindings, type ReviewPass, type Finding, type ReviewResult } from "../core/quality/review.js";
import { computeLessons, lessonsPromptBlock, lessonToSkillDescription, type Lesson, type LessonFinding, type LessonCorrection } from "../core/learning/lessons.js";
import { checkPrerequisites, type PrereqReport } from "../core/doctor/prereqs.js";
import { isValidMarketplaceSource } from "../core/install/install.js";
import { INSTALL_UNITS, runInstallPlan } from "../core/install/bootstrap.js";
import { installBundledSkills, type SkillsInstallResult } from "../core/install/bundled-skills.js";
import { makeShellRunner } from "../core/install/shell-runner.js";
import type { CmdRunner, InstallDeps } from "../core/install/types.js";
import { loomDataDir } from "../core/paths.js";

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
  /** Load command-policy block audit entries for the project (default: file audit dir). */
  loadCommandAuditEvents?: (projectId: string) => LoomEvent[];
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
  /** Tracker import drafts (default: connector chosen by opts, beads when unset). */
  importDrafts?: (opts?: ImportOptions) => TaskDraft[];
  /** Environment prerequisite check (default: which/where probe of REQUIRED_TOOLS). */
  prereqs?: () => PrereqReport;
  /** Run a `claude plugin …` CLI call (default: execFile "claude", args). Override for tests. */
  claudePlugin?: (args: string[]) => Promise<{ code: number; stdout: string }>;
  /** Command runner for the onboarding auto-installer (default: makeShellRunner — long timeout + shell). */
  installRunner?: CmdRunner;
  /** Install Loom's bundled skills into ~/.claude/skills (default: the real copy).
   *  Injectable so onboarding tests stay hermetic (no writes to the real home). */
  installSkills?: () => SkillsInstallResult;
  /** Git runner for worktree/branch cleanup (default: sync `git`). Override for tests. */
  worktreeGit?: GitRunner;
}

// Claude's config dir for an aimux profile: the source profile inherits the
// default ~/.claude; every other profile has its own dir (where aimux points
// CLAUDE_CONFIG_DIR). Used to relocate a session across accounts on switch.
const defaultClaudeDir = process.env.CLAUDE_CONFIG_DIR || pathJoin(homedir(), ".claude");
function profileConfigDir(p: { is_source?: boolean; path: string }): string {
  return p.is_source ? defaultClaudeDir : expandHome(p.path);
}

// A Claude plugin row for the Connectors UI. Parsed from `claude plugin list`.
interface PluginEntry { name: string; version?: string; enabled: boolean; bundled?: boolean }

// Plugins Loom installs and depends on (bootstrap INSTALL_UNITS). Uninstalling or
// disabling one breaks the pipeline (caveman review / qa-skills / canary) or the
// agent's tooling (token-pilot / task-journal / context-mode / superpowers), so
// the UI flags them and the API blocks remove/disable — the user can still force
// it via the claude CLI if they truly mean to. Matched by the base name (before @).
const BUNDLED_PLUGINS = new Set([
  "canary", "caveman", "context-mode", "qa-skills", "superpowers", "task-journal", "token-pilot",
]);
const pluginBaseName = (ref: string): string => ref.split("@")[0];

// Defensive parse of `claude plugin list`. The real output is a multi-line block
// per plugin:
//     ❯ name@marketplace
//       Version: 1.2.0
//       Scope: user
//       Status: ✔ enabled
// So we track the current plugin from its "name@marketplace" header line and
// attach the Version/Status that follow. Never throws; prose lines are ignored.
function parsePluginList(stdout: string): PluginEntry[] {
  const out: PluginEntry[] = [];
  let cur: PluginEntry | null = null;
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Header: an optional bullet glyph, then "<name>@<marketplace>" alone.
    const ref = line.replace(/^[^\w]+/, "").match(/^([A-Za-z0-9][\w.-]*@[\w.-]+)$/);
    if (ref) {
      cur = { name: ref[1], enabled: true, bundled: BUNDLED_PLUGINS.has(pluginBaseName(ref[1])) };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const v = line.match(/^Version:\s*(\S+)/i);
    if (v) { cur.version = v[1]; continue; }
    const s = line.match(/^Status:\s*(.+)$/i);
    // Positive match: "enabled" only when the word is actually present, so an
    // error/blank/unexpected status reads as NOT enabled (the safe default)
    // rather than the green "on" that `!disabled` produced for any odd string.
    if (s) { cur.enabled = /enabled/i.test(s[1]) && !/disabled/i.test(s[1]); continue; }
  }
  return out;
}

// Defensive parse of `claude plugin marketplace list`. A marketplace id is a
// single bare token (e.g. "owner/repo"); multi-word lines are prose/headers/
// errors ("No marketplaces configured", "claude: command not found") and are
// skipped, as are tokens with non-id characters — no phantom entries.
function parseMarketplaceList(stdout: string): string[] {
  const out: string[] = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== 1) continue; // prose / headers have multiple tokens
    const name = tokens[0];
    if (/^[A-Za-z0-9][\w.@/-]*$/.test(name)) out.push(name);
  }
  return out;
}

// Hardening for a plugin ref passed to the claude CLI: `name` or `name@marketplace`,
// safe charset, never flag-shaped. Combined with `--` and execFile (no shell) this
// rules out flag- and shell-injection.
function isSafePluginRef(name: string): boolean {
  return (
    typeof name === "string" &&
    !name.startsWith("-") &&
    /^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$/.test(name)
  );
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

/** Scale review depth to the task's analysis class: a trivial "chore" gets a
 *  single reviewer — the full self→ralph→adversarial panel (each an opus pass
 *  over the growing task session) is wasted cost on a one-line change. Features
 *  and bugs keep the whole enabled pipeline. Unknown/empty class → full set, so
 *  this only ever narrows when the analysis explicitly said "chore" (loom-ohky). */
export function reviewersForClass(keys: string[], taskClass: string | undefined): string[] {
  return taskClass === "chore" && keys.length > 1 ? keys.slice(0, 1) : keys;
}

/** True when the agent's reply is ENTIRELY a fatal error — auth/credentials, a
 *  4xx/5xx API error, or a dead session — i.e. the stage never produced real
 *  work. The pipeline uses this to PARK the stage (degraded) instead of marking
 *  it "done" on a fake-empty result: otherwise a totally-failed run (e.g. a 401
 *  on every stage) marches to "done" having done nothing. Length-bounded so a
 *  long legitimate output that merely mentions an error doesn't trip it. */
export function isFatalAgentError(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 400) return false;
  // NOTE: deliberately NOT matching 429 / rate-limit / usage-limit — those have
  // their own recovery (detectRateLimit + auto-fallback to another account). This
  // is only the terminal, no-existing-handler cases: auth/credentials, a 401/403/
  // 404/5xx API error, or a dead session.
  return /failed to authenticate|invalid authentication|authentication credentials|authentication.?failed|not logged in|please run \/login|api error:\s*(401|403|404|5\d\d)|agent process ended before replying|did not respond within the time limit|the session was stopped/i.test(t);
}

export function createApi(db: Database.Database, deps: ApiDeps = {}): Hono {
  const app = new Hono();
  // Mirror the stored command policy to the file the agent's PreToolUse(Bash)
  // hook reads, so a freshly-started server enforces the saved policy from the
  // first run (not only after the next save).
  writeCommandPolicyFile(loadSecurityConfig(db));
  const loadWorkspace = deps.loadWorkspace ?? loadWorkspaceData;
  const setActiveProfile = deps.setActiveProfile ?? saveActiveProfile;
  const addSub = deps.addSubscription ?? ((name: string, opts: { cli?: string; model?: string }) => addSubscription(name, opts));
  const doctorReport = deps.prereqs ?? (() => checkPrerequisites());
  const installRunner = deps.installRunner ?? makeShellRunner();
  const installSkills = deps.installSkills ?? installBundledSkills;
  // Guards the auto-installer: only one install run at a time. The shell installs
  // are synchronous and cannot be aborted, so a second concurrent stream (a retry
  // after a transient disconnect, or a second tab) must not launch parallel
  // `npm -g` / `cargo install` against the same machine.
  let installInFlight = false;
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
  const loadCmdAuditEvents = deps.loadCommandAuditEvents ?? ((projectId: string) => loadCommandAuditEvents(projectId));
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
  const runtime = deps.runtime ?? createClaudeRuntime({
    sandbox: () => getSetting<boolean>(db, "sandbox.enabled", false),
    egressPolicy: () => ({
      enforce: getSetting<boolean>(db, "security.egress.enforce", false),
      allow: getSetting<string[]>(db, "security.egress.allow", DEFAULT_EGRESS_ALLOW),
    }),
  });
  const recall =
    deps.recall ?? runtime.recall ?? ((query: string) => recallPrior(resolveProjectRoot(projectActive()?.root ?? process.cwd()), query, { run: recallRunner }));
  const search =
    deps.search ?? ((query: string) => askSearch(resolveProjectRoot(projectActive()?.root ?? process.cwd()), query));
  // In production, review runs through the task's session (stageAgentFor) so the
  // agent has full context. Tests inject deps.reviewPass / deps.stageAgent to
  // avoid spawning real processes.
  // Build a review pass factory. Tests inject deps.reviewPass (sync mock);
  // production runs review in the task's session so the agent has full context.
  // Stash each task's latest raw reviewer output so the review runner can check
  // it for a self-steering LOOM-RELOCATE directive (parseFindings drops it).
  const reviewRaw = new Map<string, string>();
  const makeReviewPass = (id: string, targetHint: string) => (key: string): ReviewPass => {
    if (deps.reviewPass) return deps.reviewPass(key, targetHint);
    const run = async (call: (p: string) => Promise<string>): Promise<Finding[]> => {
      const out = await call(reviewPrompt(key, targetHint) + lessonsBlock());
      reviewRaw.set(id, out);
      return parseFindings(key, out);
    };
    if (deps.stageAgent) return { key, run: () => run(deps.stageAgent!) };
    const agent = stageAgentFor(id, "review");
    return { key, run: () => run(agent) };
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
    " IMPORTANT (token economy): do NOT run tests, the build, or the full test suite — review ONLY by reading the code and diff (token-pilot smart_diff/read_symbol). Running tests is the QA stage's job, not review's.";
  const REVIEWERS: { key: string; label: string; instruction: string }[] = [
    {
      key: "self",
      label: "Self review",
      instruction:
        "Do your own review of the CURRENT code changes in this worktree following the `requesting-code-review` skill: review the diff, then run `/simplify` to flag overcomplication. Read the changed files and the diff. Look for real bugs and unnecessary complexity, not style." + REVIEW_NO_RUN,
    },
    {
      key: "ralph",
      label: "Ralph-loop",
      instruction:
        "Do an iterative deepening review of the current code changes with a MAXIMUM of 3 passes: each pass goes deeper than the last (first the obvious issues, then logic and edge cases, then subtle correctness and interactions). Return ALL issues found across all passes." + REVIEW_NO_RUN,
    },
    {
      key: "adversarial",
      label: "Adversarial",
      instruction:
        "Use the `adversarial-review` skill on the current code changes — try to break the solution (edge cases, invalid input, races, bypassing checks). Return the issues you find." + REVIEW_NO_RUN,
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
    await sessionSend(id, "impl", `Code review found issues. Fix them in the code (real changes, delegate to subagents if needed), then report briefly. Issues:\n${list}\nEnd with the RESULT line.`);
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
    if (t?.repo && isGitRepo(t.repo)) {
      const path = ensureWorktree(t.repo, id).path;
      ensureJournalTask(id); // worktree now exists → guarantee a journal, independent of the agent
      return path;
    }
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

  // L8 learning — derived lessons (recurring review findings + user corrections),
  // shared by the /api/learning/lessons endpoint and the impl/review prompt
  // injection. No store: computed on read from data that already exists.
  const projectLessons = (minRuns: number): Lesson[] => {
    const tasks = listTasks(db);
    const findings: LessonFinding[] = [];
    for (const t of tasks) {
      const rr = loadResult<ReviewPayload>(t.id, "review-result");
      for (const f of rr?.result.findings ?? []) {
        findings.push({ taskId: t.id, severity: f.severity, message: f.message, file: f.file });
      }
    }
    let corrections: LessonCorrection[] = [];
    const root = tasks.map((t) => journalProjectRoot(t.id)).find((r): r is string => !!r);
    if (root) {
      corrections = exportEventsSafe(root)
        .filter((e) => e.type === "correction")
        .map((e) => ({ taskId: e.task_id, message: e.text, ts: Date.parse(e.timestamp) || undefined }));
    }
    const dismissed = new Set(getSetting<string[]>(db, "learning.dismissed", []));
    return computeLessons(findings, corrections, {
      minRuns,
      now: Date.now(),
      staleDays: getSetting<number>(db, "learning.staleDays", 0),
    }).filter((l) => !dismissed.has(l.signature));
  };

  // Slice 1 — the "recurring issues to avoid" block appended to impl/review
  // prompts so a run benefits from past lessons. Gated by a setting; "" = off.
  const lessonsBlock = (): string =>
    getSetting<boolean>(db, "learning.injectEnabled", true)
      ? lessonsPromptBlock(projectLessons(2), getSetting<number>(db, "learning.maxLessons", 5))
      : "";
  // Refresh per-task cost after a stage: token-pilot's own used/saved stats
  // (spine-tagged via LOOM_TASK_ID) + the live session's exact $ spent. No
  // separate counter — we read what token-pilot already tracks.
  // Every Claude session id this task spans — across its model lanes (opus to
  // think, cheaper to do) plus the active conversation. Cost/denials/stop must
  // cover all of them, not just the lane in use right now.
  const taskSessionIds = (id: string): string[] => {
    const ids = new Set(getLaneSessionIds(db, id));
    const active = getTaskSession(db, id).sessionId;
    if (active) ids.add(active);
    return [...ids];
  };
  const recordSessionCost = (id: string, repoRoot: string) => {
    try {
      const ids = taskSessionIds(id);
      const spent = ids.length ? ids.reduce((sum, s) => sum + (sessionLauncher.costOf?.(s) ?? 0), 0) : undefined;
      // token-pilot's MCP-tool savings live in tool-calls.jsonl, keyed by session
      // id (not task_id) — add them on top of the hook-event totals so the Cost
      // block reflects real tool savings, not just Read-hook denials (loom-cust).
      const extra = toolCallTokensForSessions(repoRoot, ids);
      recordRunCost(db, id, { tokenEvents: tokenEventsByTime(repoRoot), spent, sessionId: ids[0], extra });
    } catch {
      // Defensive as before (never throws) — but no longer silent: surface it.
      markDegraded(id, "session cost not recorded");
    }
  };
  // Loom ships these MCP servers (bundled plugins: token-pilot@token-pilot,
  // task-journal@task-journal) and SESSION_PREAMBLE tells the agent to use them.
  // They must be allowed by default in gated/manual — else every call is denied
  // and the agent silently falls back to raw Read/Grep (losing token-pilot's
  // savings) or loses its journal (loom-hlpy). Both names are listed: the
  // plugin-delivered form (mcp__plugin_<marketplace>_<plugin>, how Loom installs
  // them) and the bare standalone-server form (mcp__<server>, e.g. task-journal
  // registered via enforced-mcp.json). The bare form allows the WHOLE server —
  // no "*", since the permission layer matches names literally (the manual
  // /permissions/allow validator even rejects "*").
  const BUNDLED_MCP_TOOLS = [
    "mcp__token-pilot",
    "mcp__plugin_token-pilot_token-pilot",
    "mcp__task-journal",
    "mcp__plugin_task-journal_task-journal",
  ];
  // manual/gated: agent may freely read/edit in the worktree + run git + use the
  // bundled MCP servers; anything else is denied and surfaced for approval.
  // autopilot: full access (no list).
  const DEFAULT_ALLOWED_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git *)", "TodoWrite", ...BUNDLED_MCP_TOOLS];
  const allowKey = (id: string) => `perm.allow.${id}`;
  const taskAllowed = (id: string): string[] => getSetting<string[]>(db, allowKey(id), []);
  const allowedToolsFor = (id: string): string[] => [...DEFAULT_ALLOWED_TOOLS, ...taskAllowed(id)];
  // Capture tools the agent was denied (await user approval) after a send.
  const recordDenials = (id: string) => {
    try {
      const denials = [...new Set(taskSessionIds(id).flatMap((s) => sessionLauncher.denialsOf?.(s) ?? []))];
      if (denials.length) saveResult(id, "permissions", "permission-denials", { denials });
    } catch {
      // Defensive as before (never throws) — but no longer silent: surface it.
      markDegraded(id, "permission denials not recorded");
    }
  };
  // Send a stage instruction into the task's ONE session (tests inject a one-shot
  // deps.stageAgent). All stages share the session + the task worktree cwd, and
  // the spine env so plugin telemetry attributes to this task.
  // Live output sinks per task: when a stage runs via the run-manager, its
  // session output streams here → run-manager record → SSE to the UI.
  const streamSinks = new Map<string, (chunk: string) => void>();
  // Redact likely secrets out of agent output the secure-executor scan never sees:
  // the LIVE stream (chunks → transcript/SSE) and generated PR bodies (M3). Gated
  // by the secret-scan toggle. Best-effort — a secret split across two stream
  // chunks can slip through, but stored turns + PR text go through whole-string.
  const redactOut = (text: string): string => {
    try {
      const cfg = loadSecurityConfig(db);
      return cfg.secretScanEnabled ? redactWithCustom(text, cfg.secretRules) : text;
    } catch { return text; }
  };
  const redactedSink = (sink: (c: string) => void) => (chunk: string) => sink(redactOut(chunk));
  const sessionSend = async (id: string, stage: string, prompt: string, opts?: { raw?: boolean }): Promise<string> => {
    if (deps.stageAgent) {
      const out = await deps.stageAgent(prompt);
      // A fatal agent error must park the stage, not complete it (see below).
      if (isFatalAgentError(out)) { markDegraded(id, `agent error: ${out.trim().slice(0, 140)}`); throw new Error(`agent send failed at ${stage}`); }
      return out;
    }
    const t = getTask(db, id);
    const repoRoot = t?.repo || process.cwd();
    const ids = buildSpineIds({ repoRoot, taskId: id });
    const autopilot = t?.run_mode === "autopilot";
    const relocations = loadResult<{ n: number }>(id, "relocate-count")?.n ?? 0; // escalates a stubborn impl to opus
    // A model the user pinned by hand wins over the policy: per-task-stage first,
    // else the per-column (stage) default.
    const modelOverride =
      getSetting<string>(db, `model.task.${id}.${stage}`, "") ||
      getSetting<string>(db, `model.col.${stage}`, "") ||
      undefined;
    // Append the response-language note from the UI-language setting (prompts stay
    // English; only the agent's reply to the user follows it). i18n: loom-y14v.
    const langPrompt = `${prompt}\n\n${languageDirective(getSetting<string>(db, "ui.language", "en"))}`;
    const { text } = await createTaskSession(db, id, { launcher: sessionLauncher }).send(langPrompt, {
      stage,
      relocations,
      modelOverride,
      raw: opts?.raw,
      cwd: taskCwd(id),
      env: spineEnv(ids),
      bypassPermissions: autopilot,
      allowedTools: autopilot ? undefined : allowedToolsFor(id),
      // Autopilot grants bypassPermissions, so confine its writes with the OS
      // sandbox regardless of the global toggle; other modes honour the Settings
      // toggle. Unavailable backend → the launcher records a degraded marker.
      sandbox: autopilot || getSetting<boolean>(db, "sandbox.enabled", false),
      onChunk: streamSinks.get(id),
      profile: t?.profile ?? undefined, // run under the task's current subscription
    });
    // A fatal agent/API error (auth/credentials/429/dead session) comes back AS
    // the reply text — the stage never really ran. Don't let the pipeline mark it
    // "done" on this fake-empty result: record it, flag the task degraded, and
    // throw so startRun records a failed run and the stage PARKS for the user to
    // fix (re-auth / switch account / retry) instead of a task that reads
    // "completed" having done nothing (loom-authfail).
    if (isFatalAgentError(text)) {
      saveResult(id, stage, "turn", { input: prompt, output: text });
      markDegraded(id, `agent error: ${text.trim().slice(0, 140)}`);
      throw new Error(`agent send failed at ${stage}: ${text.trim().slice(0, 160)}`);
    }
    // Read token-pilot stats from where the agent actually ran — its worktree —
    // not the main repo. token-pilot writes .token-pilot/hook-events.jsonl under
    // the session cwd (the worktree, which lives outside the repo in ~/.loom),
    // and those events carry this task's id; reading the main repo finds none, so
    // used/saved always showed 0 (loom-tpm). Non-git tasks fall back to the repo.
    recordSessionCost(id, taskCwd(id) ?? repoRoot);
    recordDenials(id);
    // Drain any spawn-time degradations the launcher recorded for this session
    // (MCP not loaded, token-pilot enforcement missing) onto the task — same
    // post-send readout as cost/denials. Best-effort: never break the send path.
    try {
      const sid = getTaskSession(db, id).sessionId;
      for (const what of sid ? sessionLauncher.degradedOf?.(sid) ?? [] : []) markDegraded(id, what);
    } catch { /* best-effort */ }
    saveResult(id, stage, "turn", { input: prompt, output: text }); // session transcript
    // Which model actually ran this stage (observability — opus to think, cheaper
    // to do). Raw chat continues the active lane, so it doesn't record a stage model.
    if (!opts?.raw) saveResult(id, stage, "model", { model: resolveStageModel(stage, { relocations, override: modelOverride }) });
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
  // Worktree/branch cleanup git runner (sync). Each cleanup step is best-effort so
  // a git failure never blocks task completion or boot.
  const worktreeGit: GitRunner =
    deps.worktreeGit ?? ((args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  // Drop a finished task's worktree AND its branch, then prune stale git admin
  // records. removeWorktree only removes the worktree dir — the branch leaks
  // unless deleted explicitly. Best-effort: isolate each step.
  //  - NEVER force-discard uncommitted work: if the worktree has local changes,
  //    keep it (and its branch) so nothing is lost (removeWorktree uses --force).
  //  - rmSync fallback reclaims a leftover dir whose git admin entry is already
  //    gone (git worktree remove can't, but the tree is clean so rm is safe).
  const cleanupTaskWorktree = (repoRoot: string, taskId: string): void => {
    const wt = worktreePath(taskId);
    try {
      if (existsSync(wt) && worktreeGit(["status", "--porcelain"], wt).trim()) return; // dirty → keep
    } catch { /* status failed (e.g. dir is not a live worktree) → fall through */ }
    try { removeWorktree(repoRoot, taskId, { git: worktreeGit }); } catch { /* best-effort */ }
    try { worktreeGit(["branch", "-D", worktreeBranch(taskId)], repoRoot); } catch { /* best-effort */ }
    try { worktreeGit(["worktree", "prune"], repoRoot); } catch { /* best-effort */ }
    try { if (existsSync(wt)) rmSync(wt, { recursive: true, force: true }); } catch { /* best-effort */ }
    journalEnsured.delete(taskId); // worktree removed → a re-run must re-bootstrap its journal
  };
  // Resolve the main repo root for an orphan worktree (its task row is gone) from
  // the worktree's ".git" pointer file: "gitdir: <repo>/.git/worktrees/<id>".
  // Hardened: resolve a relative pointer against the worktree dir, require the
  // standard linked-worktree layout, and confirm the result is a real git repo —
  // so a crafted ".git" can't steer git commands at an arbitrary cwd.
  const repoFromWorktree = (wtDir: string): string | undefined => {
    try {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(pathJoin(wtDir, ".git"), "utf8"));
      if (!m) return undefined;
      const gd = m[1].trim();
      const abs = isAbsolute(gd) ? gd : pathResolve(wtDir, gd);
      if (!/[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/.test(abs)) return undefined; // unexpected layout
      const repo = dirname(dirname(dirname(abs)));
      return isGitRepo(repo) ? repo : undefined; // only a real repo
    } catch { return undefined; }
  };
  // leak-guard: reclaim worktrees + branches left behind by tasks that are done
  // or no longer in the DB (e.g. deleted mid-run), and prune stale admin records.
  // INVARIANT — call ONLY at server boot (serveApi), never at runtime: it removes
  // worktrees of done tasks, which is safe only because no run is active at boot.
  // At runtime it could delete a worktree out from under an in-flight run.
  const sweepLeakedWorktrees = (): void => {
    const base = pathJoin(securityDataDir(), "worktrees");
    let entries: string[];
    try { entries = readdirSync(base); } catch { return; } // no worktrees dir → nothing to sweep
    for (const taskId of entries) {
      const t = getTask(db, taskId);
      if (t && t.status !== "done") continue; // active task → keep its worktree
      const repo = t?.repo ?? repoFromWorktree(pathJoin(base, taskId));
      if (repo) cleanupTaskWorktree(repo, taskId);
    }
    // prune stale admin entries (dirs removed by hand) across every known repo.
    for (const repo of new Set(listTasks(db).map((t) => t.repo).filter((r): r is string => !!r))) {
      try { worktreeGit(["worktree", "prune"], repo); } catch { /* best-effort */ }
    }
  };
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
  // Run a `claude plugin …` CLI call. Async (execFile, never blocks the loop)
  // with a 120s timeout: marketplace add / install are network calls that can be
  // slow, but a hung or interactive prompt (no TTY/stdin) must not pin a child
  // process and a dangling request forever — the timeout kills the child.
  const claudePlugin =
    deps.claudePlugin ??
    ((args: string[]) =>
      new Promise<{ code: number; stdout: string }>((resolve) => {
        execFile(
          "claude",
          args,
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
          (e, out, errOut) => {
            if (!e) return resolve({ code: 0, stdout: out });
            const err = e as { code?: number | string };
            const combined =
              `${out ?? ""}${errOut ?? ""}` || (err.code === "ENOENT" ? "claude: command not found" : "");
            resolve({ code: typeof err.code === "number" ? err.code : 1, stdout: combined });
          },
        );
      }));
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
  // QA depth: a per-task override (qa.mode.<id> = inherit|minimal|full) over the
  // global default (qa.mode). "full" adds an agent verification pass on top of the
  // objective checks (see the qa runner).
  const qaModeFor = (taskId: string) =>
    resolveQaMode(getSetting<string>(db, "qa.mode", "minimal"), getSetting<string>(db, `qa.mode.${taskId}`, "inherit"));
  // Full-QA agent pass: deep verification beyond tests/build. Uses the bundled
  // verification-before-completion skill; adds browser qa-skills only when the task
  // is a reachable web app (degrades cleanly otherwise — no hard plugin dep). JSON
  // findings out (same shape as review) so a `bug` finding fails QA.
  const QA_FULL_PROMPT =
    'Run a thorough QA pass on the CURRENT change. Follow the `verification-before-completion` skill: prove it actually works — exercise the real behaviour, edge cases, and error paths; don\'t assume. The objective tests/build already ran separately, so go beyond them. If (and only if) this is a web app with a reachable local URL, also run `/qa-skills:run-qa smoke` for browser checks; if it is not a web app or there is no URL, skip that and say so briefly. Return ONLY a JSON array of findings: [{ "severity": "bug|warn|info", "message": "...", "file": "..."? }]. Empty array if everything holds. No prose.';
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
  // A task whose journal is absent — non-git (no 1:1 journal project) or git but
  // the agent recorded nothing. We mark it explicitly so History shows "no
  // journal" instead of a blank, and so empty tasks are no longer invisible.
  const JOURNAL_STATUS_KIND = "journal-status";
  // Loom tasks whose journal we already guaranteed this server session — taskCwd
  // runs on every stage, so this in-memory guard keeps ensureJournalTask from
  // re-querying the journal CLI once a task is known-handled.
  const journalEnsured = new Set<string>();
  // Is the task-journal CLI actually reachable? Probed once and cached. We need
  // this to tell "the agent recorded nothing" (empty journal) apart from "the CLI
  // is missing, so we simply can't read it" — otherwise every git task would be
  // mislabelled "no journal" on a host without the CLI.
  let tjReachable: boolean | undefined;
  const tjAvailable = (): boolean => {
    if (tjReachable === undefined) {
      try { execFileSync("task-journal", ["--version"], { stdio: "ignore" }); tjReachable = true; }
      catch { tjReachable = false; }
    }
    return tjReachable;
  };
  // A leading "-" makes task-journal's CLI parse a title/goal as a flag, not a
  // value (argv injection). Strip leading dashes/space; fall back to the id when
  // nothing readable is left.
  const safeCliArg = (s: string, fallback: string): string => s.replace(/^[-\s]+/, "").trim() || fallback;
  /** Persist an explicit "this task has no reasoning journal" marker so reads can
   *  surface it. reason: "non-git" (no 1:1 journal project) | "empty" (git but
   *  the agent recorded nothing). De-duped (a repeat park with the same reason is
   *  a no-op) so repeated parks don't pile up identical artifacts. Best-effort. */
  const markNoJournal = (id: string, reason: "non-git" | "empty"): void => {
    try {
      const prev = loadResult<{ state?: string; reason?: string }>(id, JOURNAL_STATUS_KIND);
      if (prev?.state === "none" && prev.reason === reason) return; // already marked → don't accumulate
      saveResult(id, "memory", JOURNAL_STATUS_KIND, { state: "none", reason });
    } catch { /* best-effort */ }
  };
  /** Record that something silently degraded for this task (cost not recorded,
   *  journal not snapshotted, MCP not loaded, token-pilot enforcement missing …)
   *  so a "green" finish can't hide a real failure. Accumulates a de-duped list
   *  of human-readable reasons, surfaced on the task card + in the dossier.
   *  Best-effort: the visibility mechanism must never itself throw. */
  const markDegraded = (id: string, what: string): void => {
    try {
      const prev = loadResult<{ reasons?: string[] }>(id, DEGRADED_KIND);
      const reasons = prev?.reasons ?? [];
      if (reasons.includes(what)) return; // already noted → don't accumulate duplicates
      saveResult(id, "system", DEGRADED_KIND, { reasons: [...reasons, what] });
    } catch { /* best-effort */ }
  };
  /** Load the degraded reasons recorded for a task ("" list when healthy). */
  const degradedReasons = (id: string): string[] =>
    loadResult<{ reasons?: string[] }>(id, DEGRADED_KIND)?.reasons ?? [];
  /** Guarantee a journal exists for a git task at START (worktree creation),
   *  independent of whether the agent called task_create. Idempotent: a
   *  per-session guard plus a check for an existing journal task keep repeat
   *  stage runs from creating duplicates (the guard is cleared when the worktree
   *  is cleaned, so a re-run re-bootstraps). Non-git tasks have no 1:1 journal
   *  project, so they are skipped here (marked "no journal" at snapshot time).
   *  Best-effort: a journal-CLI failure must never block the task. */
  const ensureJournalTask = (id: string): void => {
    if (journalEnsured.has(id)) return;
    try {
      const root = journalProjectRoot(id);
      if (!root) { journalEnsured.add(id); return; } // non-git → no dedicated journal project
      const t = getTask(db, id);
      const existing = tasksFromEvents(exportEventsSafe(root));
      if (existing.length) {
        // Agent (or a prior call) already opened a journal task → just bind it.
        for (const jt of existing) bindExternal(root, jt.id, `loom:${id}`);
      } else {
        const jid = openTask(root, safeCliArg(t?.title || id, id), safeCliArg(t?.description || t?.title || id, id));
        if (jid) bindExternal(root, jid, `loom:${id}`);
      }
      journalEnsured.add(id);
    } catch {
      /* journal bootstrap is best-effort */
    }
  };
  /** A board task's story as Markdown. Prefer task-journal's OWN `export-pr`
   *  narrative (Summary / Changes / Why / Verification / Affected) while the
   *  worktree exists; then the Done-time snapshot of that story (survives the
   *  worktree's deletion); then a raw-event render as a universal fallback
   *  (export --project still works after the dir is gone); finally an explicit
   *  "no journal" marker when one was recorded. */
  const boardJournalPack = (id: string): string => {
    const root = journalProjectRoot(id);
    if (root) {
      if (existsSync(worktreePath(id))) {
        const story = boardTaskStory(root); // task-journal's native export-pr
        if (story.trim()) return story;
      }
      // The Done-time snapshot (story or raw events) is the authoritative record
      // once the worktree is gone — it must beat the live `boardTaskJournal` read,
      // which reads the repo's journal project and can be racy/empty (and made
      // this test flaky). Snapshot first, live read only as a last resort.
      const snap = loadResult<{ events?: TjEvent[]; story?: string }>(id, JOURNAL_SNAPSHOT_KIND);
      if (snap?.story?.trim()) return snap.story;
      const rendered = snap?.events ? renderJournalFromEvents(snap.events) : "";
      if (rendered.trim()) return rendered;
      const live = boardTaskJournal(root);
      if (live.trim()) return live;
    }
    // Nothing to show — surface the explicit "no journal" marker if we recorded one.
    const status = loadResult<{ state?: string; reason?: string }>(id, JOURNAL_STATUS_KIND);
    if (status?.state === "none") {
      return `No reasoning journal was recorded for this task (${status.reason === "non-git" ? "non-git task" : "agent recorded nothing"}).`;
    }
    return "";
  };
  /** Persist the agent's story + journal and bind it to loom:<id> (best-effort).
   *  Called at Done AND at every park/terminal transition while the worktree
   *  still exists, so both the readable export-pr story and the raw events
   *  outlive cleanup. A task with no journal is marked explicitly (non-git, or
   *  git-but-empty) rather than silently skipped. */
  const snapshotJournal = (id: string): void => {
    try {
      const root = journalProjectRoot(id);
      if (!root) { markNoJournal(id, "non-git"); return; } // only a git worktree is 1:1 with the board task
      const events = exportEventsSafe(root);
      // Empty AND the CLI is reachable → the agent genuinely recorded nothing.
      // If the CLI is unreachable we can't tell, so we don't assert "no journal".
      if (!events.length) { if (tjAvailable()) markNoJournal(id, "empty"); return; }
      saveResult(id, "memory", JOURNAL_SNAPSHOT_KIND, { events, story: boardTaskStory(root) });
      for (const t of tasksFromEvents(events)) bindExternal(root, t.id, `loom:${id}`);
    } catch {
      // Defensive as before (never throws) — but no longer silent: surface it.
      markDegraded(id, "journal snapshot failed");
    }
  };
  /** Park a task: flip it to "waiting" and snapshot its journal NOW (before any
   *  worktree cleanup), unless it already finished. Single chokepoint for every
   *  terminal/park transition (rate-limit, cost-cap, stop, auto-fallback) so the
   *  journal is never lost when a task stops short of Done. Returns false if the
   *  task was already done (no-op). */
  const parkIfNotDone = (id: string): boolean => {
    if (getTask(db, id)?.status === "done") return false;
    updateTaskStatus(db, id, "waiting");
    snapshotJournal(id);
    return true;
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
  // L13.x agent self-steering: if a stage agent emitted a LOOM-RELOCATE directive,
  // honour it within the per-task budget (loop guard) and audit the move as a
  // visible turn. Returns the relocate for runStage to execute, or undefined.
  const applyRelocate = (id: string, fromStage: string, agentText: string): Relocate | undefined => {
    const rel = parseRelocate(agentText);
    if (!rel || rel.stage === fromStage) return undefined;
    const used = loadResult<{ n: number }>(id, "relocate-count")?.n ?? 0;
    if (!relocateAllowed(used)) {
      recordTurn(id, fromStage, "Self-steer ignored", `Relocate budget reached — staying in ${fromStage} (wanted ${rel.stage}: ${rel.reason})`);
      return undefined;
    }
    saveResult(id, "system", "relocate-count", { n: used + 1 });
    recordTurn(id, fromStage, "Agent self-steered the task", `${fromStage} → ${rel.stage}: ${rel.reason}`);
    return rel;
  };
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
    "R&D stage — planning. Follow the `writing-plans` skill. Break the task into self-sufficient subtasks (a plan/DAG): for each, describe exactly what gets implemented, which files it touches, and the done criterion. Do NOT write code yet. At the end state the status on the RESULT line.";
  const IMPL_PROMPT =
    "Implementation stage. Work by the `executing-plans` skill (go through the plan step by step) and `test-driven-development` (failing test first → minimal code → refactor); when stuck, `systematic-debugging`. Implement the ENTIRE plan — all subtasks/epics, NOT just the first. Make real changes to the code (delegate to subagents via `subagent-driven-development` when needed) and verify the result. Don't stop after one epic. If for any reason you couldn't finish everything — at the end you MUST add the line 'RESULT: NOT DONE — <what's left>'. Write 'RESULT: DONE' ONLY when the whole plan is implemented and verified.";
  const IMPL_CONTINUE_PROMPT =
    "Continue the implementation: take the NEXT unfinished items of the plan and carry them through (real changes in the code + verification). When the whole plan is implemented and verified — 'RESULT: DONE'; otherwise 'RESULT: NOT DONE — <what's left>'.";
  const IMPL_MAX_CONTINUES = 6; // bound the auto-continue loop so a huge/looping plan parks instead of running forever
  const doneProjectId = () => projectActive()?.projectId ?? "default";

  // ── Impl-as-swarm (preview, gated by swarm.impl.enabled) ──────────────────────
  const swarmConfigFor = (stage: string): StageSwarmConfig =>
    resolveSwarmConfig(getSetting<unknown>(db, "swarm.default", {}), getSetting<unknown>(db, `swarm.${stage}`, {}));
  const JUDGE_PROMPT =
    "You are judging candidate implementations of the SAME task — each already passed the objective QA checks. Pick the ONE best: simplest correct change, cleanest diff, least risk. Reply with the winner as 'sw<N>' on the first line, then one short sentence why.";
  // Run impl as a swarm of N candidates (each in its own worktree), gate each on
  // QA, let a judge elect the winner, then promote it onto the task branch (git
  // reset --hard) and drop the losers. Autopilot-only + expensive (N impl agents).
  // Returns the report to record, or null to fall back to the single-impl path
  // (nothing passed QA, or promotion failed). Live agents + git promote — verify
  // by dogfood before trusting.
  const runImplAsSwarm = async (id: string, cfg: StageSwarmConfig): Promise<{ report: string } | null> => {
    const t = getTask(db, id);
    if (!t?.repo || !isGitRepo(t.repo)) return null;
    const repo = t.repo;
    const base = worktreeBranch(id); // each attempt branches from the task's current state
    const ids = buildSpineIds({ repoRoot: repo, taskId: id });
    const model = getSetting<string>(db, `model.task.${id}.impl`, "") || getSetting<string>(db, "model.col.impl", "") || undefined;
    const lang = languageDirective(getSetting<string>(db, "ui.language", "en"));
    const git: GitRunner = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });
    const costs: Array<number | undefined> = [];
    const failures: string[] = []; // why each dropped attempt failed (observability)
    // A swarm attempt is a FRESH session with no accumulated task context (unlike
    // the single-impl which resumes the lane that ran analysis/rd). Inject the task
    // + analysis + spec so the agent knows WHAT to build instead of re-exploring
    // from scratch (which times out).
    const implContext = [
      `TASK:\n${taskSpec(id)}`,
      (latestArtifact(db, id, "analysis")?.content ?? "").trim() && `ANALYSIS:\n${latestArtifact(db, id, "analysis")!.content}`,
      (latestArtifact(db, id, "spec-md")?.content ?? "").trim() && `SPEC:\n${latestArtifact(db, id, "spec-md")!.content}`,
    ].filter(Boolean).join("\n\n");
    const implement = async (slot: number, perspective: string | undefined) => {
      try {
        const wt = prepareSwarmWorktree(repo, id, slot, { base });
        const instruction = `${perspectivePrompt(IMPL_PROMPT, perspective)}\n\n${implContext}`;
        const body = `${stageInstruction("impl", instruction)}\n\n${TOOLS_ANCHOR}\n\n${lang}`;
        // The session id is passed to claude as `--session-id <uuid>`, which MUST be
        // a valid UUID — a slug like `${id}-sw${slot}` makes claude exit immediately
        // ("agent process ended before replying"). Use a fresh UUID per attempt.
        const sid = randomUUID();
        const r = await sessionLauncher.run(`${SESSION_PREAMBLE}\n\n${body}`, { sessionId: sid, resume: false, model, cwd: wt.path, env: spineEnv(ids), bypassPermissions: true, sandbox: true, profile: t.profile ?? undefined });
        costs.push(sessionLauncher.costOf?.(sid)); // fresh session → this attempt's spend
        if (isFatalAgentError(r.text)) throw new Error(`agent error: ${r.text.trim().slice(0, 120)}`);
        const c = commitWorktree(wt.path, `loom: ${t.title} (sw${slot})`);
        if (!c.committed) throw new Error("no change committed (agent made no edit)");
        return { branch: wt.branch, output: r.text };
      } catch (e) {
        failures.push(`sw${slot}: ${(e as Error).message}`);
        throw e;
      }
    };
    const qaGate = async (slot: number) => {
      // Gate candidates on `build` only (tsc + bundler + design-system) — it runs
      // reliably in a worktree, whereas the full test suite (vitest) is fragile
      // there (node_modules symlink, loom-xzqv). This is a viability filter to pick
      // among BUILDABLE candidates; the elected winner still goes through the full
      // QA stage (tests) after promotion, which parks the task if it regresses.
      const res = await runQa(buildQaChecks(["build"], { repoRoot: swarmWorktreePath(id, slot) }));
      return { green: res.passed, summary: fmtQa(res) };
    };
    const judge = async (greens: { slot: number; branch: string; output: string }[]) => {
      const summaries = greens.map((g) => `### sw${g.slot} (${g.branch})\n${g.output.trim().slice(0, 800)}`).join("\n\n");
      const out = await sessionSend(id, "impl", `${JUDGE_PROMPT}\n\n${summaries}`);
      const m = out.match(/sw\s*(\d+)/i);
      const pick = m ? Number(m[1]) : greens[0].slot;
      return { winnerSlot: greens.some((g) => g.slot === pick) ? pick : greens[0].slot, rationale: out.trim().slice(0, 200) };
    };
    const result = await runImplSwarm({ attempts: cfg.attempts, perspectives: cfg.perspectives, implement, qaGate, judge, concurrency: 1 });
    const survivors = result.attempts.filter((a) => a.green).length;
    const projectId = t.project_id ?? doneProjectId();
    appendLoomEvent(projectId, swarmRunEvent({ projectId, taskId: id, stage: "impl", attempts: result.attempts.length, survivors, agree: result.winner ? 1 : 0, winner: result.winner ? `sw${result.winner.slot}` : undefined, costUsd: sumAttemptCost(costs), ts: Date.now() }));
    // Persist the per-attempt outcome (why each failed, who survived/won) so a
    // swarm that elects nothing is debuggable instead of a silent fallback.
    saveResult(id, "impl", "swarm-debug", { attempts: result.attempts.map((a) => ({ slot: a.slot, green: a.green, qa: a.qa })), failures, winner: result.winner?.slot ?? null, rationale: result.rationale });
    const cleanup = () => { for (let k = 0; k < cfg.attempts; k++) removeSwarmWorktree(repo, id, k); };
    if (!result.winner) { cleanup(); return null; } // nothing passed QA → single-impl fallback
    try {
      git(["reset", "--hard", result.winner.branch], ensureWorktree(repo, id).path); // promote onto the task branch
    } catch { cleanup(); return null; }
    cleanup();
    return { report: `Impl-swarm: ${result.attempts.length} candidates, ${survivors} passed QA → elected sw${result.winner.slot}. ${result.rationale}` };
  };
  const defaultRunners: RunnerRegistry = {
    analysis: async (_d, id) => { await runAnalysis(db, id, taskSpec(id), stageAgentFor(id, "analysis")); return { ok: true }; },
    brainstorm: async (_d, id) => {
      // Manual mode is human-driven via StageDialog (/brainstorm/message) — the
      // runner stays a no-op so it can't auto-skip the human's dialog. Autopilot
      // self-drives: the agent asks + answers clarifying questions from the task
      // and analysis, logs accepted assumptions to task-journal, and only parks
      // on a genuine blocker.
      if (getTask(db, id)?.run_mode !== "autopilot") return { ok: true };
      const analysis = latestArtifact(db, id, "analysis")?.content ?? "";
      const res = await runAutoBrainstorm(db, id, stageAgentFor(id, "brainstorm"), { spec: taskSpec(id), analysis });
      recordTurn(id, "brainstorm", "Auto-brainstorm (autopilot)", res.blocked ? `Parked: ${res.note}` : "Resolved from context");
      return res.blocked ? { ok: true, needsAttention: true, note: res.note } : { ok: true };
    },
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
      // Impl-as-swarm (preview): when swarm.impl.enabled and the task is autopilot,
      // run N candidates and promote the judged winner. Falls through to single
      // impl when disabled, not autopilot, or nothing passed QA.
      const swCfg = swarmConfigFor("impl");
      if (swCfg.enabled && getTask(db, id)?.run_mode === "autopilot") {
        const sw = await runImplAsSwarm(id, swCfg);
        if (sw) {
          saveResult(id, "impl", "impl-report", { report: sw.report });
          recordTurn(id, "impl", "Implementation (swarm)", sw.report);
          return { ok: true };
        }
      }
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
      let text = await sessionSend(id, "impl", IMPL_PROMPT + lessonsBlock());
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
      const implRel = applyRelocate(id, "impl", text);
      if (implRel) return { ok: true, relocate: implRel };
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
        const activeKeys = reviewersForClass(resolvedReviewerKeys(), getSetting<string>(db, `analysis.class.${id}`, ""));
        for (let i = 0; i < activeKeys.length; i++) {
          const reviewer = REVIEWERS.find((r) => r.key === activeKeys[i])!;
          const findings = await runReviewer(id, reviewer);
          payload = recordReviewer(id, reviewer.key, findings, { reset: i === 0 });
        }
        recordTurn(id, "review", `Review (${activeKeys.join(" → ")})`, fmtReview(payload!.result));
        // Self-steer takes precedence over auto-fix: if the reviewer judged the
        // work needs an earlier stage (e.g. back to analysis), move it there
        // instead of patching findings in place.
        const reviewRel = applyRelocate(id, "review", reviewRaw.get(id) ?? "");
        if (reviewRel) return { ok: true, relocate: reviewRel };
        // Autopilot fixes the accumulated findings once, then re-reviews. But the
        // fix + re-review is itself expensive (another fix pass + reviewers on a
        // large session), and the fix may not even converge. So when the task has
        // already spent past the auto-fix budget, DON'T pay for a fix attempt that
        // might fail anyway — park with the findings surfaced for a manual fix +
        // re-run (loom-wqzr). 0 = no cap.
        if (payload!.result.findings.length) {
          const spentNow = getCosts(db, id).filter((r) => r.source === "aimux" && r.metric === "spent").reduce((s, r) => s + r.value, 0);
          const autofixCapUsd = getSetting<number>(db, "review.autofixMaxUsd", 6);
          if (autofixCapUsd > 0 && spentNow >= autofixCapUsd) {
            recordTurn(id, "review", "Auto-fix skipped (cost cap)", `Review found ${payload!.result.findings.length} issue(s). The task has already spent $${spentNow.toFixed(2)} ≥ the $${autofixCapUsd} auto-fix cap — parking for a manual fix instead of an expensive (and possibly non-converging) auto-fix loop.`);
            return { ok: false, needsAttention: true, note: `review auto-fix skipped — cost cap $${autofixCapUsd} reached` };
          }
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
      // Full mode adds an agent verification pass on top of the objective checks;
      // a `bug` finding fails QA just like a failed check. Minimal mode = checks only.
      const mode = qaModeFor(id);
      let findings: Finding[] = [];
      if (mode === "full") findings = parseFindings("qa", await sessionSend(id, "qa", QA_FULL_PROMPT));
      const passed = res.passed && findings.filter((f) => f.severity === "bug").length === 0;
      saveResult(id, "qa", "qa-result", { result: res, mode, findings });
      recordTurn(id, "qa", mode === "full" ? "QA: objective checks + verification pass" : "Run the repo's checks", fmtQa(res));
      return { ok: passed, needsAttention: !passed };
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
      // Default PR options: in autopilot, actually push the branch to origin and
      // return the host's "open a PR" link — Loom's push+link feature (we never
      // auto-create the PR itself). Manual/gated stays description-only; the user
      // pushes on demand via POST /api/tasks/:id/pr. Tests inject deps.prOptions,
      // which wins. sh+repoRoot+branch are passed either way so the description
      // gets a real change summary (commits + diffstat), not just the task spec.
      const prOpts: PrOptions = deps.prOptions?.(id) ?? {
        connector: prT?.run_mode === "autopilot",
        sh: realSh,
        repoRoot: prWt,
        branch: worktreeBranch(id),
      };
      const pr = await runPr(db, id, prOpts);
      pr.description = redactOut(pr.description); // M3: never store/show secrets in the PR body
      saveResult(id, "pr", "pr-result", pr);
      recordTurn(id, "pr", "Generate the PR description", pr.description);
      // Pushed (autopilot) → Loom's part is done, advance. Otherwise — description
      // only, or a push that failed — park for the human to push + open the PR,
      // rather than silently finishing with nothing on origin. A push error is
      // already saved on pr-result so it isn't a silent stall.
      return { ok: true, needsAttention: !pr.pushed };
    },
    done: async (_d, id) => {
      runDone(db, id, { projectId: doneProjectId(), closeTask: () => deps.closeTask?.(id) });
      snapshotJournal(id); // after close: capture the full reasoning (incl. outcome) before worktree cleanup
      await snapshotDiff(id); // and freeze the git diff --stat before the branch is merged + deleted
      recordTurn(id, "done", "Finalize the task", "Task finished and closed.");
      // task finished → stop every lane's live process, free resources
      for (const s of taskSessionIds(id)) sessionLauncher.stop?.(s);
      // History is snapshotted (journal + diff) above → drop the worktree + branch
      // so they don't leak. Only for git tasks with a real repo.
      const dt = getTask(db, id);
      if (dt?.repo && isGitRepo(dt.repo)) cleanupTaskWorktree(dt.repo, id);
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
    }, {
      // Guarantee a stop always kills the live agent process (else status flips but
      // Claude keeps running + billing). Resolve the session from the task.
      stopLive: (rec) => {
        if (!rec.taskId) return;
        const sid = getTaskSession(db, rec.taskId).sessionId;
        if (sid) sessionLauncher.stop?.(sid);
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
        streamSinks.set(taskId, redactedSink(ctx.appendOutput));
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
        } catch (e) {
          // Surface WHY a run died instead of a silent hang (loom-jrhg): log the
          // stack and mark the task so the user sees the failure. Re-throw so the
          // run-manager still records it as a failed run.
          console.error(`[loom] stage "${stageKey}" for ${taskId} failed:`, e instanceof Error ? e.stack : e);
          markDegraded(taskId, `stage ${stageKey} failed: ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        } finally {
          streamSinks.delete(taskId);
        }
      });
    });

  app.get("/api/health", (c) => c.json({ ok: true }));
  // D2.2 — first-run environment check: are the required CLIs on PATH? Wraps the
  // core prereqs probe so the onboarding wizard can show a status without a terminal.
  app.get("/api/doctor", (c) => c.json(doctorReport()));
  // D2.2 — auto-install missing deps/plugins, streaming per-step progress over
  // SSE so the wizard can install everything (cargo, claude, bundled plugins)
  // without a terminal. Idempotent: detect() skips anything already present.
  app.get("/api/onboarding/install/stream", (c) =>
    streamSSE(c, async (stream) => {
      // Best-effort SSE write: a disconnected client must not throw out of the
      // (unabortable) install loop. Also stop early once the client is gone.
      const send = async (e: { kind: string }) => {
        if (stream.aborted) return;
        try { await stream.writeSSE({ event: e.kind, data: JSON.stringify(e) }); } catch { /* client gone */ }
      };
      if (installInFlight) {
        await send({ kind: "done" });
        return;
      }
      installInFlight = true;
      try {
        const ideps: InstallDeps = { dataDir: loomDataDir(), run: installRunner };
        await runInstallPlan(INSTALL_UNITS, ideps, send);
        // Loom's bundled skills → ~/.claude/skills (idempotent; never clobbers a
        // user's own skill of the same name).
        const sk = installSkills();
        const skillsEv = {
          kind: "step",
          id: "skills",
          title: "Loom skills",
          state: "done",
          message: sk.installed.length ? `installed ${sk.installed.join(", ")}` : "already present",
        };
        await send(skillsEv);
      } finally {
        installInFlight = false;
      }
    }));
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
    // Merge BOTH token-pilot sources per session: hook-events.jsonl (Read-hook
    // denials) + tool-calls.jsonl (smart_read/read_symbol MCP savings). The
    // dashboard previously read only hook-events, so it understated savings and
    // disagreed with the per-task Cost block — which already sums both (loom-cust).
    const merged = new Map<string, { sessionId: string; used: number; saved: number }>();
    for (const r of [...tokenUsageBySession(projectRoot), ...toolCallUsageBySession(projectRoot)]) {
      const e = merged.get(r.sessionId) ?? { sessionId: r.sessionId, used: 0, saved: 0 };
      e.used += r.used;
      e.saved += r.saved;
      merged.set(r.sessionId, e);
    }
    const rows = [...merged.values()];
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
  // The per-stage model policy + the tiers a user can pick by hand. The UI shows
  // the default per stage and writes overrides via /api/settings (model.col.<stage>
  // for a column, model.task.<id>.<stage> for one task).
  app.get("/api/model-config", (c) =>
    c.json({
      stageDefaults: STAGE_MODEL,
      tiers: MODEL_TIERS,
      columns: Object.fromEntries(
        Object.keys(STAGE_MODEL).map((s) => [s, getSetting<string>(db, `model.col.${s}`, "")]).filter(([, v]) => v),
      ),
    }),
  );

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
      degraded: degradedReasons(id), // what silently degraded (cost/journal/MCP/token-pilot), [] when healthy
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
    // A task with no explicit repo runs in its project's repo — derive it from the
    // project root so the run can create a worktree. Without it taskCwd has no repo,
    // the stage never gets a working dir, and the run hangs silently (loom-szvp).
    const projectRoot = projectId ? projectsList().find((p) => p.projectId === projectId)?.root : undefined;
    const task = createTask(db, {
      id,
      title,
      repo: repo || projectRoot || undefined,
      branch: typeof body.branch === "string" ? body.branch : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      // Fall back to the global default run mode (Settings), not a hardcoded
      // "gated" — so the Settings "Default run mode" actually takes effect (loom-wkhe).
      run_mode: typeof body.run_mode === "string" ? body.run_mode : getSetting<string>(db, "run_mode", "gated"),
      route: Array.isArray(body.route) ? (body.route as string[]) : undefined,
      profile: typeof body.profile === "string" && body.profile ? body.profile : (loadActiveProfile() ?? undefined),
      projectId,
    });
    // Per-task QA depth override (inherit|minimal|full). "inherit"/absent → the
    // task follows the global qa.mode default; only persist a real override.
    if (body.qaMode === "minimal" || body.qaMode === "full") setSetting(db, `qa.mode.${id}`, body.qaMode);
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
    // Reclaim the task's worktree + branch now (don't leak until the next boot's
    // leak-guard). Clean-tree guarded inside cleanupTaskWorktree, so an in-progress
    // task with uncommitted work keeps its worktree.
    const dt = getTask(db, id);
    if (dt?.repo && isGitRepo(dt.repo)) cleanupTaskWorktree(dt.repo, id);
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
    parkIfNotDone(id); // snapshot the journal before the run ends, unless already done
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
      streamSinks.set(id, redactedSink(ctx.appendOutput));
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
          if (res.stoppedAt) parkIfNotDone(id);
          return { outcome: { ok: true }, stoppedAt: res.stoppedAt, reason: res.reason };
        }
        // manual/gated: raw resume of the same conversation under the new subscription
        await sessionSend(id, "chat", "Continue from where you left off.", { raw: true });
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
      streamSinks.set(id, redactedSink(ctx.appendOutput));
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
        degraded: degradedReasons(id),
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
  // Also merges command-policy block entries from ~/.loom/audit/ so the Security
  // panel's audit trail reflects real blocked commands (audit.command.blocked).
  app.get("/api/timeline", (c) => {
    const projectId = resolveProjectId(c);
    const events = [...loadEvents(projectId), ...loadCmdAuditEvents(projectId)].sort((a, b) => a.ts - b.ts);
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

  // ─── learning (L8) ──────────────────────────────────────────────────────────────
  // Endpoint defined below; the helpers `projectLessons` / `lessonsBlock` are
  // hoisted to module scope earlier (so impl/review injection can use them).
  app.get("/api/learning/lessons", (c) => {
    return c.json({ lessons: projectLessons(Number(c.req.query("minRuns")) || 2) });
  });
  // Slice 2 — generate a SKILL.md draft from a lesson (human-in-control: a manual
  // "Create skill" click; the draft lands in the editable skills library).
  app.post("/api/learning/skill", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { signature?: unknown; profile?: unknown };
    const signature = typeof body.signature === "string" ? body.signature : "";
    const lesson = projectLessons(2).find((l) => l.signature === signature);
    if (!lesson) return c.json({ error: "lesson not found" }, 404);
    const profile = typeof body.profile === "string" ? body.profile : undefined;
    const agent = deps.skillAgent ?? createAimuxStageAgent({ profile });
    const r = await runtime.skills.generate(lessonToSkillDescription(lesson), agent);
    return r ? c.json(r) : c.json({ error: "generation produced no valid skill" }, 422);
  });
  // Dismiss a lesson (a wrong/irrelevant one): it stops being shown AND injected.
  // POST adds it, DELETE restores it (so a mistaken dismiss is reversible).
  app.post("/api/learning/dismiss", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { signature?: unknown };
    const signature = typeof body.signature === "string" ? body.signature : "";
    if (!signature) return c.json({ error: "signature required" }, 400);
    const set = new Set(getSetting<string[]>(db, "learning.dismissed", []));
    set.add(signature);
    setSetting(db, "learning.dismissed", [...set]);
    return c.json({ ok: true });
  });
  app.delete("/api/learning/dismiss", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { signature?: unknown };
    const signature = typeof body.signature === "string" ? body.signature : "";
    const set = new Set(getSetting<string[]>(db, "learning.dismissed", []));
    set.delete(signature);
    setSetting(db, "learning.dismissed", [...set]);
    return c.json({ ok: true });
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
      streamSinks.set(id, redactedSink(ctx.appendOutput));
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
        if (res.stoppedAt) parkIfNotDone(id);
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
    if (res.stoppedAt) parkIfNotDone(id);
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
    // History snapshotted → drop the worktree + branch so they don't leak.
    const dt = getTask(db, id);
    if (dt?.repo && isGitRepo(dt.repo)) cleanupTaskWorktree(dt.repo, id);
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
    const b = (await c.req.json().catch(() => ({}))) as {
      id?: unknown;
      command?: unknown;
      args?: unknown;
      env?: unknown;
      transport?: unknown;
      url?: unknown;
    };
    if (typeof b.id !== "string" || !b.id) return c.json({ error: "id required" }, 400);
    const transport =
      b.transport === "sse" || b.transport === "http" || b.transport === "stdio" ? b.transport : undefined;
    const remote = transport === "sse" || transport === "http";
    if (remote) {
      // Trim so a whitespace-only url can't slip past the "required" check.
      const url = typeof b.url === "string" ? b.url.trim() : "";
      if (!url) return c.json({ error: "url required for remote server" }, 400);
      return c.json({ server: addMcp({ id: b.id, transport, url }) }, 201);
    }
    const command = typeof b.command === "string" ? b.command.trim() : "";
    if (!command) return c.json({ error: "command required for stdio server" }, 400);
    const args = Array.isArray(b.args) ? (b.args.filter((a) => typeof a === "string") as string[]) : undefined;
    const env =
      b.env && typeof b.env === "object" && !Array.isArray(b.env)
        ? Object.fromEntries(
            Object.entries(b.env as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>
        : undefined;
    return c.json({ server: addMcp({ id: b.id, command, args, env, transport }) }, 201);
  });
  app.post("/api/connectors/mcp/:id/toggle", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    const ok = toggleMcp(c.req.param("id"), b.enabled !== false);
    return ok ? c.json({ ok: true }) : c.json({ error: "unknown server" }, 404);
  });
  app.post("/api/connectors/mcp/:id/remove", (c) => { removeMcp(c.req.param("id")); return c.json({ ok: true }); });
  app.post("/api/connectors/mcp/:id/test", (c) => c.json(testMcp(c.req.param("id"), { probe: deps.mcpProbe ?? realMcpProbe })));
  // D5.5 — available tracker connectors (drives the import selector in the UI).
  app.get("/api/connectors", (c) => c.json({ connectors: CONNECTORS }));
  // D5.4/5.5 — import open tracker items as tasks on the board.
  app.post("/api/connectors/import", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { connector?: unknown; repo?: unknown };
    const connector = typeof b.connector === "string" && b.connector ? b.connector : "beads";
    // Trim server-side so a whitespace-only repo can't slip past the guard below.
    const repo = typeof b.repo === "string" && b.repo.trim() ? b.repo.trim() : undefined;
    const meta = CONNECTORS.find((m) => m.id === connector);
    // Reject an unknown connector id outright (a typo must not look like success).
    if (!meta) return c.json({ error: "unknown connector" }, 400);
    // Connectors that need a repo (e.g. github) must be given one.
    if (meta.needsRepo && !repo) return c.json({ error: "repo required" }, 400);
    // Call importDrafts AS A METHOD (not a torn-off reference) so a future
    // AgentRuntime whose connectors rely on `this` keeps its binding.
    const opts: ImportOptions = { connector, repo };
    const drafts = deps.importDrafts ? deps.importDrafts(opts) : runtime.connectors.importDrafts(opts);
    let created = 0;
    let skipped = 0;
    for (const d of drafts) {
      // Idempotent: a draft already imported (same external item) is skipped so
      // re-running import never duplicates tasks. An empty id is treated as no
      // ref (no dedup, external_ref stays NULL); drafts without an external id
      // are created as before.
      const ref = d.externalId ? d.externalId : undefined;
      if (ref && findTaskByExternalRef(db, ref)) {
        skipped += 1;
        continue;
      }
      createTask(db, { id: `t-${randomUUID().slice(0, 8)}`, title: d.title, description: d.description, externalRef: ref });
      created += 1;
    }
    return c.json({ created, skipped });
  });

  // ─── connectors: Claude plugins ───────────────────────────────────────────────
  // Thin wrappers over the same `claude plugin …` CLI the install recipes run.
  // Every handler is defensive: a CLI failure becomes { ok:false, error } and
  // never throws out of the route.
  app.get("/api/connectors/plugins", async (c) => {
    try {
      const r = await claudePlugin(["plugin", "list"]);
      return c.json({ plugins: parsePluginList(r.stdout) });
    } catch {
      return c.json({ plugins: [] });
    }
  });
  app.post("/api/connectors/plugins", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!isSafePluginRef(name)) return c.json({ error: "invalid plugin name" }, 400);
    try {
      const r = await claudePlugin(["plugin", "install", "--", name]);
      return r.code === 0 ? c.json({ ok: true }) : c.json({ ok: false, error: r.stdout || "install failed" });
    } catch (e) {
      return c.json({ ok: false, error: String(e) });
    }
  });
  // update / uninstall / enable / disable all share the same shape: validate the
  // :name, run `claude plugin <verb> -- <name>`, map the exit code to ok/error.
  const pluginAction = (verb: string) => async (c: Context) => {
    const name = c.req.param("name") ?? "";
    if (!isSafePluginRef(name)) return c.json({ error: "invalid plugin name" }, 400);
    // Don't let the UI remove/disable a plugin Loom's pipeline depends on.
    if ((verb === "uninstall" || verb === "disable") && BUNDLED_PLUGINS.has(pluginBaseName(name))) {
      return c.json({ ok: false, error: `${pluginBaseName(name)} is bundled with Loom and required by the pipeline — ${verb} is blocked here. Use the claude CLI directly if you really need to.` }, 409);
    }
    try {
      const r = await claudePlugin(["plugin", verb, "--", name]);
      return r.code === 0 ? c.json({ ok: true }) : c.json({ ok: false, error: r.stdout || `${verb} failed` });
    } catch (e) {
      return c.json({ ok: false, error: String(e) });
    }
  };
  app.post("/api/connectors/plugins/:name/update", pluginAction("update"));
  app.post("/api/connectors/plugins/:name/uninstall", pluginAction("uninstall"));
  app.post("/api/connectors/plugins/:name/enable", pluginAction("enable"));
  app.post("/api/connectors/plugins/:name/disable", pluginAction("disable"));
  app.get("/api/connectors/marketplaces", async (c) => {
    try {
      const r = await claudePlugin(["plugin", "marketplace", "list"]);
      return c.json({ marketplaces: parseMarketplaceList(r.stdout) });
    } catch {
      return c.json({ marketplaces: [] });
    }
  });
  app.post("/api/connectors/marketplaces", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { source?: unknown };
    const source = typeof b.source === "string" ? b.source.trim() : "";
    // Reuse the sanitizeSynthRecipe hardening: reject flag-shaped / invalid sources.
    if (!isValidMarketplaceSource(source)) return c.json({ error: "invalid source" }, 400);
    try {
      const r = await claudePlugin(["plugin", "marketplace", "add", "--", source]);
      return r.code === 0 ? c.json({ ok: true }) : c.json({ ok: false, error: r.stdout || "add failed" });
    } catch (e) {
      return c.json({ ok: false, error: String(e) });
    }
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
    // Mirror to the file the agent's PreToolUse(Bash) hook reads, so the edit
    // takes effect on the next command without a restart.
    writeCommandPolicyFile(loadSecurityConfig(db));
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
      streamSinks.set(id, redactedSink(ctx.appendOutput));
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
      streamSinks.set(id, redactedSink(ctx.appendOutput));
      try {
        updateTaskStatus(db, id, "running");
        const res = await advanceTask(db, id, runners, advanceOpts());
        if (res.stoppedAt) parkIfNotDone(id);
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
  (app as Hono & { sweepLeakedWorktrees?: () => void }).sweepLeakedWorktrees = sweepLeakedWorktrees;

  return app;
}
