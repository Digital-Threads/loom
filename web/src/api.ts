// Typed client for the loom local API. fetch is injectable so the client is
// testable without a server / DOM.
import { toast } from "./toast";

export interface BoardCard {
  id: string;
  title: string;
  stageKey: string;
  status: string;
  projectId: string;
}
export interface BoardColumn {
  stageKey: string;
  cards: BoardCard[];
}
export interface AttentionItem {
  taskId: string;
  title: string;
  stageKey: string;
}
export interface TaskRow {
  id: string;
  title: string;
  status: string;
  run_mode: string;
  route: string | null;
  repo: string | null;
  branch: string | null;
  description: string | null;
  profile?: string | null;
  project_id?: string | null;
  session_id?: string | null;
  created_at: number;
  updated_at: number;
}
export interface StageRow {
  task_id: string;
  stage_key: string;
  status: string;
  gate: number;
  started_at: number | null;
  finished_at: number | null;
}
export interface StepRow {
  id: string;
  task_id: string;
  title: string;
  approach: string | null;
  agent: string | null;
  model: string | null;
  profile: string | null;
  depends_on: string | null;
  status: string;
  exit_code: number | null;
}
export interface CostRow {
  task_id: string;
  source: string;
  metric: string;
  value: number;
  exact: number;
}
export interface StopReason { kind: string; resetsAt?: string | null; profile?: string | null; cap?: number; spent?: number }
export interface TaskDetail {
  task: TaskRow;
  stages: StageRow[];
  steps: StepRow[];
  costs: CostRow[];
  stopReason?: StopReason | null;
  degraded?: string[]; // silent failures surfaced (cost/journal/MCP/token-pilot); [] when healthy
  ultracode?: boolean; // task opted into fan-out (swarm on the hard stages)
}

export type Fetcher = typeof fetch;

// A 5xx is an unexpected server fault → surface it globally as a toast. A 4xx is
// expected/validation and is handled by the caller, so it just throws quietly.
function onHttpError(path: string, status: number): Error {
  if (status >= 500) toast.error(`Server error (${status}) — ${path.replace(/^.*\/api\//, "/api/")}`);
  return new Error(`${path} → ${status}`);
}

async function getJson<T>(path: string, f: Fetcher): Promise<T> {
  const res = await f(path);
  if (!res.ok) throw onHttpError(path, res.status);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown, f: Fetcher, method = "POST"): Promise<T> {
  const res = await f(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw onHttpError(path, res.status);
  return (await res.json()) as T;
}

async function deleteJson<T>(path: string, f: Fetcher): Promise<T> {
  const res = await f(path, { method: "DELETE" });
  if (!res.ok) throw onHttpError(path, res.status);
  return (await res.json()) as T;
}

export interface NewTask {
  title: string;
  repo?: string;
  branch?: string;
  description?: string;
  run_mode?: string;
  profile?: string;
  projectId?: string;
  /** Per-task QA depth override: "minimal" | "full". Omit to inherit the global default. */
  qaMode?: string;
  /** Ultracode: opt this (big) task into fan-out — swarm on the hard stages. */
  ultracode?: boolean;
}

// ── 3-module workspace (aimux / token-pilot / task-journal) — F1 ──────────────
export interface Subscription { name: string; cli?: string; isSource?: boolean; authKind?: "oauth" | "api" | "none"; [k: string]: unknown }
export interface SessionRow { sessionId?: string; profile?: string; lastUsedAtMs?: number; [k: string]: unknown }
// aimux HealthReport: a profile is healthy when nothing is broken/missing/conflicting.
export interface HealthRow { profile: string; ok?: boolean; valid?: string[]; broken?: string[]; missing?: string[]; conflicts?: string[]; [k: string]: unknown }
// D2.2 — environment prerequisite probe (mirror of core PrereqReport). `optional`
// tools (e.g. cargo, only for building from source) don't block the main path.
export interface ToolStatus { name: string; found: boolean; hint: string; optional?: boolean }
export interface PrereqReport { ok: boolean; tools: ToolStatus[]; missing: string[] }
export interface TokenUsageRow { sessionId: string; used: number; saved: number; [k: string]: unknown }
export interface TokenEvent { sessionId: string; used: number; saved: number; ts: number; [k: string]: unknown }
export interface TjTaskSummary { id: string; title: string; status?: string; [k: string]: unknown }
export interface TjEventRow { event_id: string; task_id: string; type: string; text: string; [k: string]: unknown }
export interface ProjectStat { projectId: string; name: string; root: string; tasks: number; used: number; saved: number; active: boolean }
export interface TokenSession { sessionId: string; used: number; saved: number; taskTitle?: string; profile: string }
export interface TokenProfile { profile: string; used: number; saved: number }
export interface TokensReport { totals: { used: number; saved: number }; byProfile: TokenProfile[]; bySession: TokenSession[] }
export interface AuthView { status: "starting" | "awaiting_code" | "done" | "error"; url?: string; authorized: boolean; error?: string }
export interface RateLimit {
  profile: string;
  fiveHourPct: number;
  weeklyPct: number;
  fiveHourResetsAt?: number;
  weeklyResetsAt?: number;
  status?: string;
}
export interface WorkspaceData {
  subscriptions: Subscription[];
  sessions: SessionRow[];
  health: HealthRow[];
  tokens: TokenUsageRow[];
  tokenEvents: TokenEvent[];
  taskEvents: TjEventRow[];
  tasks: TjTaskSummary[];
  errors: string[];
  activeProfile?: string | null;
  projectId: string;
}
export interface MemoryEntry {
  event_id?: string;
  type?: string;
  timestamp?: string;
  text?: string;
  source?: string;
  [k: string]: unknown;
}
export interface MemoryDetail {
  decisions: MemoryEntry[];
  findings: MemoryEntry[];
  rejections: MemoryEntry[];
  [k: string]: unknown;
}

export function createClient(base = "", f: Fetcher = fetch) {
  return {
    board: () => getJson<{ columns: BoardColumn[] }>(`${base}/api/board`, f).then((d) => d.columns),
    attention: () => getJson<{ items: AttentionItem[] }>(`${base}/api/attention`, f).then((d) => d.items),
    tasks: () => getJson<{ tasks: TaskRow[] }>(`${base}/api/tasks`, f).then((d) => d.tasks),
    task: (id: string) => getJson<TaskDetail>(`${base}/api/tasks/${id}`, f),
    create: (input: NewTask) => postJson<{ task: TaskRow }>(`${base}/api/tasks`, input, f).then((d) => d.task),
    deleteTask: (id: string) => deleteJson<{ ok: boolean }>(`${base}/api/tasks/${encodeURIComponent(id)}`, f),
    stopTask: (id: string) =>
      postJson<{ ok: boolean }>(`${base}/api/tasks/${encodeURIComponent(id)}/stop`, {}, f),
    start: (id: string) => postJson<{ active: string | null }>(`${base}/api/tasks/${id}/start`, {}, f),
    accept: (id: string, key: string) =>
      postJson<{ next: string | null }>(`${base}/api/tasks/${id}/stages/${key}/accept`, {}, f),
    setGate: (id: string, key: string, gate: boolean) =>
      postJson<{ ok: boolean }>(`${base}/api/tasks/${id}/stages/${key}/gate`, { gate }, f),
    // board drag-drop: reposition a task to a stage column. run:true also starts
    // that stage immediately in the task's session (carries prior steps' context).
    moveTask: (id: string, stageKey: string, run?: boolean) =>
      postJson<{ current: string | null; runId?: string }>(`${base}/api/tasks/${id}/move`, { stageKey, run }, f),
    // F1 — 3 core modules
    workspace: () => getJson<WorkspaceData>(`${base}/api/workspace`, f),
    // D2.2 — first-run environment check: which required CLIs are on PATH.
    doctor: () => getJson<PrereqReport>(`${base}/api/doctor`, f),
    // D2.2 — SSE URL for the auto-installer; the wizard opens an EventSource on it.
    installMissingStreamUrl: () => `${base}/api/onboarding/install/stream`,
    accountsHealth: () =>
      postJson<{ health: HealthRow[] }>(`${base}/api/accounts/health`, {}, f).then((d) => d.health),
    setActive: (profileId: string) =>
      postJson<{ active: string }>(`${base}/api/accounts/active`, { profileId }, f).then((d) => d.active),
    addSubscription: (name: string, opts?: { cli?: string; model?: string }) =>
      postJson<{ ok: boolean; error?: string }>(`${base}/api/accounts/subscription`, { name, ...opts }, f),
    listPresets: () =>
      getJson<{ presets: { key: string; label: string; baseUrl: string }[] }>(`${base}/api/accounts/presets`, f).then((d) => d.presets),
    addProviderPreset: (name: string, provider: string, token: string) =>
      postJson<{ ok: boolean; error?: string }>(`${base}/api/accounts/preset`, { name, provider, token }, f),
    removeSubscription: (name: string) =>
      postJson<{ ok: boolean; error?: string }>(`${base}/api/accounts/subscription/remove`, { name }, f),
    authStart: (name: string) =>
      postJson<{ authId: string }>(`${base}/api/accounts/${encodeURIComponent(name)}/auth/start`, {}, f).then((d) => d.authId),
    authStatus: (authId: string) =>
      getJson<AuthView>(`${base}/api/accounts/auth/${authId}`, f),
    authCode: (authId: string, code: string) =>
      postJson<{ ok: boolean }>(`${base}/api/accounts/auth/${authId}/code`, { code }, f),
    memoryTask: (id: string) =>
      getJson<{ detail: MemoryDetail }>(`${base}/api/memory/tasks/${id}`, f).then((d) => d.detail),
    memoryPack: (id: string) =>
      getJson<{ pack: string }>(`${base}/api/memory/tasks/${id}/pack`, f).then((d) => d.pack),
    dossier: (id: string) =>
      getJson<{ pack: string }>(`${base}/api/tasks/${id}/dossier`, f).then((d) => d.pack),
    boardJournal: (id: string) =>
      getJson<{ pack: string }>(`${base}/api/memory/board/${id}`, f).then((d) => d.pack),
    // D3 — projects
    projects: () => getJson<{ projects: ProjectEntry[]; active: string | null }>(`${base}/api/projects`, f),
    projectStats: () => getJson<{ stats: ProjectStat[] }>(`${base}/api/projects/stats`, f).then((d) => d.stats),
    removeProject: (projectId: string) =>
      postJson<{ ok: boolean; error?: string }>(`${base}/api/projects/remove`, { projectId }, f),
    addProject: (root: string) =>
      postJson<{ project: ProjectEntry }>(`${base}/api/projects`, { root }, f).then((d) => d.project),
    setActiveProject: (projectId: string) =>
      postJson<{ active: string }>(`${base}/api/projects/active`, { projectId }, f).then((d) => d.active),
    // L4 — runs
    startRun: (taskId: string, stageKey: string) =>
      postJson<{ runId: string }>(`${base}/api/tasks/${taskId}/stages/${stageKey}/run`, {}, f).then((d) => d.runId),
    runStreamUrl: (runId: string) => `${base}/api/runs/${runId}/stream`,
    // the task's currently-running run (to reconnect after reload/navigation)
    activeRun: (taskId: string) =>
      getJson<{ runId: string | null }>(`${base}/api/tasks/${taskId}/active-run`, f).then((d) => d.runId),
    // loom-isd.13 — inject input into a live run (intervene)
    sendStdin: (runId: string, data: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/runs/${runId}/stdin`, { data }, f),
    // folder picker — list sub-directories of a path
    fsList: (path?: string) =>
      getJson<DirListing>(`${base}/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`, f),
    // L9 — observability
    timeline: () => getJson<{ events: TimelineEvent[] }>(`${base}/api/timeline`, f).then((d) => d.events),
    flowConfig: (stage: string) => getJson<{ passes: string[] }>(`${base}/api/flow-config/${stage}`, f).then((d) => d.passes),
    saveFlowConfig: (stage: string, passes: string[]) => postJson<{ ok: boolean }>(`${base}/api/flow-config/${stage}`, { passes }, f),
    boardMetrics: () => getJson<{ used: number; saved: number; events: number }>(`${base}/api/metrics/board`, f),
    agentMetrics: () =>
      getJson<{ agents: AgentPerf[]; failures: FailureReason[] }>(`${base}/api/metrics/agents`, f),
    // L7 — knowledge
    recall: (q: string) =>
      getJson<{ hits: RecallHit[]; decisions: RecallHit[]; rejections: RecallHit[] }>(
        `${base}/api/knowledge/recall?q=${encodeURIComponent(q)}`,
        f,
      ),
    search: (q: string) =>
      getJson<{ hits: RecallHit[] }>(`${base}/api/knowledge/search?q=${encodeURIComponent(q)}`, f),
    // L8 — learning lessons (recurring findings + user corrections)
    lessons: (minRuns?: number) =>
      getJson<{ lessons: Lesson[] }>(`${base}/api/learning/lessons${minRuns ? `?minRuns=${minRuns}` : ""}`, f),
    skillFromLesson: (signature: string) =>
      postJson<{ name: string; content: string }>(`${base}/api/learning/skill`, { signature }, f),
    dismissLesson: (signature: string) =>
      postJson<{ ok: boolean }>(`${base}/api/learning/dismiss`, { signature }, f),
    // L12 — dialog stages
    analysisRun: (id: string) =>
      postJson<{ class: string; route: string[] }>(`${base}/api/tasks/${id}/analysis/run`, {}, f),
    analysisGet: (id: string) =>
      getJson<{ result: { class: string; route: string[] } | null; text: string | null }>(`${base}/api/tasks/${id}/analysis`, f),
    brainstormMessages: (id: string) =>
      getJson<{ messages: ChatMessage[] }>(`${base}/api/tasks/${id}/brainstorm/messages`, f).then((d) => d.messages),
    brainstormMessage: (id: string, message?: string) =>
      postJson<{ question: string }>(`${base}/api/tasks/${id}/brainstorm/message`, { message }, f).then((d) => d.question),
    brainstormDone: (id: string) =>
      postJson<{ summary: Artifact }>(`${base}/api/tasks/${id}/brainstorm/done`, {}, f).then((d) => d.summary),
    specGet: (id: string) => getJson<{ spec: Artifact | null }>(`${base}/api/tasks/${id}/spec`, f).then((d) => d.spec),
    specDraft: (id: string) => postJson<{ spec: Artifact }>(`${base}/api/tasks/${id}/spec/draft`, {}, f).then((d) => d.spec),
    specReturn: (id: string, comment: string) =>
      postJson<{ spec: Artifact }>(`${base}/api/tasks/${id}/spec/return`, { comment }, f).then((d) => d.spec),
    specAccept: (id: string) => postJson<{ spec: Artifact }>(`${base}/api/tasks/${id}/spec/accept`, {}, f).then((d) => d.spec),
    // L6 — quality
    // Run the next reviewer in the pipeline (self → ralph → adversarial), or a
    // specific one. `ran` is the reviewer that ran; `next` is the one still to
    // run (null when all three are done → fix all findings).
    reviewRun: (id: string, opts?: { reviewer?: string }) =>
      postJson<{ result: ReviewResult; action: string; reviewersDone: string[]; ran: string; next: string | null }>(`${base}/api/tasks/${id}/review/run`, opts ?? {}, f),
    reviewGet: (id: string) =>
      getJson<{ result: ReviewResult | null; action?: string; reviewersDone?: string[] }>(`${base}/api/tasks/${id}/review`, f),
    // agent fixes the review findings in-session, then auto re-reviews (streamed)
    reviewFix: (id: string) =>
      postJson<{ runId: string }>(`${base}/api/tasks/${id}/review/fix`, {}, f).then((d) => d.runId),
    switchProfile: (id: string, profile: string, resume = true) =>
      postJson<{ runId?: string }>(`${base}/api/tasks/${id}/switch-profile`, { profile, resume }, f).then((d) => d.runId ?? null),
    tokensReport: (project?: string) =>
      getJson<TokensReport>(`${base}/api/tokens${project ? `?project=${encodeURIComponent(project)}` : ""}`, f),
    accountLimits: (profile?: string) =>
      getJson<{ limits: RateLimit[] }>(`${base}/api/accounts/limits${profile ? `?profile=${encodeURIComponent(profile)}` : ""}`, f).then((d) => d.limits),
    qaRun: (id: string, opts?: { checks?: string[] }) =>
      postJson<{ result: QaResult }>(`${base}/api/tasks/${id}/qa/run`, opts ?? {}, f).then((d) => d.result),
    qaGet: (id: string) =>
      getJson<{ result: QaResult | null }>(`${base}/api/tasks/${id}/qa`, f).then((d) => d.result),
    rdGet: (id: string) =>
      getJson<{ plan: string | null }>(`${base}/api/tasks/${id}/rd`, f).then((d) => d.plan),
    implGet: (id: string) =>
      getJson<{ report: string | null }>(`${base}/api/tasks/${id}/impl`, f).then((d) => d.report),
    transcript: (id: string) =>
      getJson<{ turns: { stage: string; input: string; output: string }[] }>(`${base}/api/tasks/${id}/transcript`, f).then((d) => d.turns),
    // free-form chat with the task's agent at any stage → streams a reply turn
    chat: (id: string, message: string, stage?: string) =>
      postJson<{ runId: string }>(`${base}/api/tasks/${id}/chat`, { message, stage }, f).then((d) => d.runId),
    // read a file the agent produced (restricted to the task's repo) for the viewer
    readFile: (id: string, path: string) =>
      getJson<{ path: string; content: string }>(`${base}/api/tasks/${id}/file?path=${encodeURIComponent(path)}`, f),
    // colored git diff of the task's work (whole worktree, or one file)
    readDiff: (id: string, path?: string) =>
      getJson<{ diff: string; base: string | null }>(`${base}/api/tasks/${id}/diff${path ? `?path=${encodeURIComponent(path)}` : ""}`, f),
    permissions: (id: string) =>
      getJson<{ denials: string[]; allowed: string[] }>(`${base}/api/tasks/${id}/permissions`, f),
    permissionAllow: (id: string, tool: string) =>
      postJson<{ allowed: string[] }>(`${base}/api/tasks/${id}/permissions/allow`, { tool }, f),
    // L11 — extensibility
    layers: () => getJson<{ layers: LayerInfo[] }>(`${base}/api/layers`, f).then((d) => d.layers),
    // Skills library (~/.claude/skills): list / read / edit / AI-generate.
    skills: () => getJson<{ skills: SkillMeta[] }>(`${base}/api/skills`, f).then((d) => d.skills),
    skillGet: (name: string) => getJson<{ name: string; content: string }>(`${base}/api/skills/${encodeURIComponent(name)}`, f),
    skillSave: (name: string, content: string) => postJson<{ ok: boolean }>(`${base}/api/skills/${encodeURIComponent(name)}`, { content }, f, "PUT"),
    skillDelete: (name: string) => postJson<{ ok: boolean }>(`${base}/api/skills/${encodeURIComponent(name)}`, {}, f, "DELETE"),
    skillGenerate: (description: string, profile?: string) =>
      postJson<{ name: string; content: string }>(`${base}/api/skills/generate`, { description, profile }, f),
    // L13 — conductor
    advance: (id: string) =>
      postJson<{ runId: string }>(`${base}/api/tasks/${id}/advance`, {}, f).then((d) => d.runId),
    runStageNext: (id: string) =>
      postJson<{ ran: string[]; stoppedAt: string | null }>(`${base}/api/tasks/${id}/run-stage`, {}, f),
    // L14 — PR / Done
    prRun: (id: string, opts?: { connector?: boolean; base?: string }) =>
      postJson<{ pr: PrResult }>(`${base}/api/tasks/${id}/pr/run`, opts ?? {}, f).then((d) => d.pr),
    prGet: (id: string) =>
      getJson<{ pr: PrResult | null }>(`${base}/api/tasks/${id}/pr`, f).then((d) => d.pr),
    prConnector: (id: string) =>
      getJson<{ remote: boolean; repo: boolean }>(`${base}/api/tasks/${id}/pr/connector`, f),
    doneRun: (id: string) => postJson<{ ok: boolean }>(`${base}/api/tasks/${id}/done/run`, {}, f),
    // D5 — connectors (MCP)
    mcpList: () => getJson<{ servers: McpServer[] }>(`${base}/api/connectors/mcp`, f).then((d) => d.servers),
    mcpAdd: (s: {
      id: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      transport?: McpTransport;
      url?: string;
    }) =>
      postJson<{ server: McpServer }>(`${base}/api/connectors/mcp`, s, f).then((d) => d.server),
    mcpToggle: (id: string, enabled: boolean) =>
      postJson<{ ok: boolean }>(`${base}/api/connectors/mcp/${id}/toggle`, { enabled }, f),
    mcpRemove: (id: string) => postJson<{ ok: boolean }>(`${base}/api/connectors/mcp/${id}/remove`, {}, f),
    mcpTest: (id: string) => postJson<{ ok: boolean; error?: string }>(`${base}/api/connectors/mcp/${id}/test`, {}, f),
    listConnectors: () => getJson<{ connectors: ConnectorMeta[] }>(`${base}/api/connectors`, f).then((d) => d.connectors),
    importTracker: (opts?: { connector?: string; repo?: string }) =>
      postJson<{ created: number }>(`${base}/api/connectors/import`, opts ?? {}, f),
    // Connectors — Claude plugins (thin wrappers over the `claude plugin …` CLI).
    pluginList: () =>
      getJson<{ plugins: PluginEntry[] }>(`${base}/api/connectors/plugins`, f).then((d) => d.plugins),
    pluginInstall: (name: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/connectors/plugins`, { name }, f),
    pluginUpdate: (name: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/connectors/plugins/${encodeURIComponent(name)}/update`, {}, f),
    pluginUninstall: (name: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/connectors/plugins/${encodeURIComponent(name)}/uninstall`, {}, f),
    pluginEnable: (name: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/connectors/plugins/${encodeURIComponent(name)}/enable`, {}, f),
    pluginDisable: (name: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/connectors/plugins/${encodeURIComponent(name)}/disable`, {}, f),
    marketplaceList: () =>
      getJson<{ marketplaces: string[] }>(`${base}/api/connectors/marketplaces`, f).then((d) => d.marketplaces),
    marketplaceAdd: (source: string) =>
      postJson<{ ok?: boolean; error?: string }>(`${base}/api/connectors/marketplaces`, { source }, f),
    // D6 — settings / attachments
    settings: () => getJson<Record<string, unknown>>(`${base}/api/settings`, f),
    saveSetting: (key: string, value: unknown) => postJson<{ ok: boolean }>(`${base}/api/settings`, { key, value }, f),
    modelConfig: () =>
      getJson<{ stageDefaults: Record<string, string>; tiers: string[]; columns: Record<string, string> }>(`${base}/api/model-config`, f),
    attachments: (id: string) =>
      getJson<{ attachments: Attachment[] }>(`${base}/api/tasks/${id}/attachments`, f).then((d) => d.attachments),
    addAttachment: (id: string, a: { kind: "file" | "link"; name: string; pathOrUrl: string }) =>
      postJson<{ attachment: Attachment }>(`${base}/api/tasks/${id}/attachments`, a, f).then((d) => d.attachment),
    // Security policy / secret-scan configuration
    securityPolicy: () => getJson<SecurityPolicyData>(`${base}/api/security/policy`, f),
    saveSecurityPolicy: (allow: string[], deny: string[]) =>
      postJson<{ ok?: boolean; error?: string; summary?: PolicySummary }>(`${base}/api/security/policy`, { allow, deny }, f),
    securitySecrets: () => getJson<SecuritySecretsData>(`${base}/api/security/secrets`, f),
    saveSecuritySecrets: (custom: SecretRule[], enabled: boolean) =>
      postJson<{ ok?: boolean; error?: string; enabled?: boolean; custom?: SecretRule[] }>(
        `${base}/api/security/secrets`,
        { custom, enabled },
        f,
      ),
    // Flip only the on/off switch — leaves custom rules untouched (partial update).
    setSecretScanEnabled: (enabled: boolean) =>
      postJson<{ ok?: boolean; error?: string; enabled?: boolean }>(`${base}/api/security/secrets`, { enabled }, f),
  };
}

export interface DirEntry { name: string; path: string; isGitRepo: boolean }
export interface DirListing { path: string; parent: string | null; entries: DirEntry[] }

export interface Attachment { id: string; kind: string; name: string; path_or_url: string }

export interface SecretRule { kind: string; source: string }
export interface PolicySummary {
  allowCount: number;
  denyCount: number;
  defaultDenyCount: number;
  secretRuleCount: number;
  defaultSecretKindCount: number;
  secretScanEnabled: boolean;
}
export interface SecurityPolicyData {
  defaults: { deny: string[] };
  allow: string[];
  deny: string[];
  summary: PolicySummary;
}
export interface SecuritySecretsData {
  defaults: string[];
  custom: SecretRule[];
  enabled: boolean;
}
export interface ConnectorMeta {
  id: string;
  label: string;
  needsRepo: boolean;
}
export type McpTransport = "stdio" | "sse" | "http";
export interface McpServer {
  id: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpTransport;
  url?: string;
  enabled: boolean;
}
export interface PluginEntry {
  name: string;
  version?: string;
  enabled: boolean;
  bundled?: boolean; // shipped + required by Loom's pipeline → can't be removed/disabled here
}

export interface LayerInfo {
  id: string;
  title: string;
  node: string;
  status: "standalone" | "inline";
  source: string;
  description: string;
  executes: boolean;
  slots: { stage: string; skill: string }[];
}
export interface SkillMeta { name: string; description: string; userInvocable: boolean; file: string; kind: "dir" | "file" }

export interface ReviewFinding { pass: string; severity: string; message: string; file?: string }
export interface ReviewResult { findings: ReviewFinding[]; counts: Record<string, number>; passed: boolean }
export interface PrResult { description: string; created: boolean; pushed?: boolean; compareUrl?: string; url?: string; connector: boolean; error?: string }
export interface QaResult { passed: boolean; results: { key: string; ok: boolean; output?: string }[] }

export interface ChatMessage { id: string; role: string; content: string }
export interface Artifact { id: string; kind: string; content: string; version: number; status: string }

export interface RecallHit {
  taskId: string;
  eventType: string;
  text: string;
  score: number;
}

// L8 — a recurring lesson (derived view): a review finding that recurs across
// tasks, or an explicit user correction.
export interface Lesson {
  signature: string;
  kind: "finding" | "correction";
  severity?: string;
  file?: string;
  occurrences: number;
  taskIds: string[];
  sampleMessages: string[];
  firstSeen?: number;
  lastSeen?: number;
  trend?: { recent: number; prior: number };
}

// L7.3 — kind of a reasoning-graph node, derived client-side from recall hits.
export type GraphNodeKind = "decision" | "rejection" | "other";

export interface TimelineEvent {
  ts: number;
  source: string;
  type: string;
  taskId?: string;
  profileId?: string;
  severity?: string;
  message?: string;
  metrics?: Record<string, number>;
}
export interface AgentPerf { profile: string; runs: number; failures: number; durationMs: number }
export interface FailureReason { message: string; count: number }

export interface ProjectEntry {
  projectId: string;
  root: string;
  name: string;
  type?: string;
  addedAt: number;
}

export type LoomClient = ReturnType<typeof createClient>;

export const STAGE_LABELS: Record<string, string> = {
  analysis: "Analysis",
  brainstorm: "Brainstorm",
  spec: "Spec",
  rd: "R&D",
  impl: "Implementation",
  review: "Review",
  qa: "QA",
  pr: "PR",
  done: "Done",
};
