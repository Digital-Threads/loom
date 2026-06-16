import { execFileSync } from "node:child_process";
import type { SettingsSchema, LoomPlugin, ViewSpec } from "../contract.js";

export interface TjEvent {
  event_id: string;
  task_id: string;
  type: string;
  timestamp: string;
  text: string;
  meta?: { title?: string; [k: string]: unknown };
}

export interface TaskSummary {
  id: string;
  title: string;
  status: "open" | "closed";
}

export interface TaskDetail {
  decisions: TjEvent[];
  findings: TjEvent[];
  rejections: TjEvent[];
}

export function tasksFromEvents(events: TjEvent[]): TaskSummary[] {
  const byTask = new Map<string, TjEvent[]>();
  for (const ev of events) {
    const list = byTask.get(ev.task_id) ?? [];
    list.push(ev);
    byTask.set(ev.task_id, list);
  }

  const summaries: { summary: TaskSummary; latest: string }[] = [];
  for (const [id, list] of byTask) {
    const openEvent = list.find((e) => e.type === "open");
    let title = "";
    if (openEvent) {
      title = openEvent.meta?.title ?? openEvent.text ?? "";
    } else if (list.length > 0) {
      title = list[0].text ?? "";
    }

    let latestClose = "";
    let latestReopen = "";
    let latest = "";
    for (const e of list) {
      if (e.timestamp > latest) latest = e.timestamp;
      if (e.type === "close" && e.timestamp > latestClose) latestClose = e.timestamp;
      if (e.type === "reopen" && e.timestamp > latestReopen) latestReopen = e.timestamp;
    }

    const status: "open" | "closed" =
      latestClose !== "" && latestClose >= latestReopen ? "closed" : "open";

    summaries.push({ summary: { id, title, status }, latest });
  }

  summaries.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
  return summaries.map((s) => s.summary);
}

export function taskDetailFromEvents(events: TjEvent[], id: string): TaskDetail {
  const own = events
    .filter((e) => e.task_id === id)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  return {
    decisions: own.filter((e) => e.type === "decision"),
    findings: own.filter((e) => e.type === "finding"),
    rejections: own.filter((e) => e.type === "rejection"),
  };
}

function exportEvents(projectRoot: string): TjEvent[] {
  const raw = execFileSync(
    "task-journal",
    ["export", "--format", "json", "--project", projectRoot],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as TjEvent[]) : [];
}

export function loadTaskEvents(projectRoot: string): TjEvent[] {
  try {
    return exportEvents(projectRoot);
  } catch {
    return [];
  }
}

export function listTasks(projectRoot: string): TaskSummary[] {
  try {
    return tasksFromEvents(exportEvents(projectRoot));
  } catch {
    return [];
  }
}

export function taskDetail(projectRoot: string, id: string): TaskDetail {
  try {
    return taskDetailFromEvents(exportEvents(projectRoot), id);
  } catch {
    return { decisions: [], findings: [], rejections: [] };
  }
}

/** The task-journal's own readable dossier (Goal / Outcome / Artifacts /
 *  Decisions+alternatives / Rejected / Evidence / Lifecycle) as Markdown. This
 *  is task-journal's `pack` render — the canonical, clean view of a task's
 *  history. Empty string on any failure (tj missing / unknown task). */
export function taskPack(projectRoot: string, id: string, mode: "compact" | "full" = "full"): string {
  // `id` comes from the request path — reject anything that isn't a plain
  // task id so it can't be smuggled in as a CLI flag, and stop option parsing
  // with `--` before the value.
  if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith("-")) return "";
  try {
    return execFileSync(
      "task-journal",
      ["pack", id, "--mode", mode, "--project", projectRoot],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    return "";
  }
}

/** The dossier for a Loom board task: its journal is linked by the external
 *  reference `loom:<board task id>` (set by the MCP auto-bind). Renders that
 *  journal's pack. Empty string when no journal is linked yet. */
export function taskPackByLoomId(projectRoot: string, boardTaskId: string, mode: "compact" | "full" = "full"): string {
  if (!/^[A-Za-z0-9._-]+$/.test(boardTaskId) || boardTaskId.startsWith("-")) return "";
  try {
    return execFileSync(
      "task-journal",
      ["pack", "--external", `loom:${boardTaskId}`, "--mode", mode, "--project", projectRoot],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } catch {
    return "";
  }
}

export interface TaskTokens {
  used: number;
  saved: number;
}

const TOKEN_METRIC_PREFIX = "loom-tokens:";

export function formatTokenMetric(t: TaskTokens): string {
  return `${TOKEN_METRIC_PREFIX} ${JSON.stringify({ used: t.used, saved: t.saved })}`;
}

export function parseTokenMetric(text: string): TaskTokens | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(TOKEN_METRIC_PREFIX)) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(TOKEN_METRIC_PREFIX.length));
    const used = parsed?.used;
    const saved = parsed?.saved;
    if (typeof used !== "number" || !Number.isFinite(used)) return null;
    if (typeof saved !== "number" || !Number.isFinite(saved)) return null;
    return { used, saved };
  } catch {
    return null;
  }
}

export function tokenMetricsFromEvents(events: TjEvent[], id: string): TaskTokens[] {
  return events
    .filter((e) => e.task_id === id && e.type === "evidence")
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
    .map((e) => parseTokenMetric(e.text))
    .filter((m): m is TaskTokens => m !== null);
}

export function writeTokenMetric(projectRoot: string, taskId: string, t: TaskTokens): boolean {
  try {
    execFileSync(
      "task-journal",
      ["event", "--type", "evidence", "--text", formatTokenMetric(t), taskId],
      { cwd: projectRoot, encoding: "utf8" },
    );
    return true;
  } catch {
    return false;
  }
}

// task-journal has no config file (verified via --help): records are only action-like
// (create/event/close). There are no configurable fields -> the schema is empty.
export function settingsSchema(): SettingsSchema {
  return { fields: [] };
}

export function openTask(projectRoot: string, title: string, goal?: string): string | null {
  try {
    const args = ["create", title];
    if (goal) args.push("--goal", goal);
    const out = execFileSync("task-journal", args, { cwd: projectRoot, encoding: "utf8" });
    // Empirically `task-journal create` prints the bare id on a single line (e.g. "tj-7ft7swrwfr").
    // We take the last whitespace token of the last non-empty line -- robust even to a bare id.
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    const id = lines[lines.length - 1].split(/\s+/).pop() ?? "";
    return id || null;
  } catch {
    return null;
  }
}

export interface CloseTaskOptions {
  reason?: string;
  outcome?: string;
  outcomeTag?: "done" | "abandoned" | "superseded";
}

export function closeTask(projectRoot: string, taskId: string, opts: CloseTaskOptions = {}): boolean {
  try {
    const args = ["close", taskId];
    if (opts.reason) args.push("--reason", opts.reason);
    if (opts.outcome) args.push("--outcome", opts.outcome);
    if (opts.outcomeTag) args.push("--outcome-tag", opts.outcomeTag);
    execFileSync("task-journal", args, { cwd: projectRoot, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

// Single-plugin derivations know only taskEvents from the aggregated WorkspaceData.
// The contract types data as unknown -- we take the minimal shape locally.
type TjDerivationData = { taskEvents: TjEvent[] };
function tjEvents(data: unknown): TjEvent[] {
  return (data as TjDerivationData).taskEvents;
}

// Task event sections as {text} items (cleaned + slice(0,100) -- like section() in TaskDetail).
function eventLines(events: { event_id: string; text: string }[]): Array<{ event_id: string; text: string }> {
  return events.map((e) => ({ event_id: e.event_id, text: e.text.replace(/\s+/g, " ").slice(0, 100) }));
}

// the plugin object is assembled from the existing functions above -- no new logic.
export const plugin: LoomPlugin<{
  taskEvents: TjEvent[];
  tasks: TaskSummary[];
}> = {
  id: "task-journal",
  title: "task-journal",
  category: "memory",
  capabilities: { install: false, data: true, settings: false, actions: true },
  tabs: [{ id: "tasks", title: "Tasks" }],
  load: (ctx) => {
    const taskEvents = loadTaskEvents(ctx.projectRoot);
    return { taskEvents, tasks: tasksFromEvents(taskEvents) };
  },
  settings: {
    schema: settingsSchema(),
    read: () => ({}),
    write: () => false,
  },
  actions: [
    {
      id: "openTask",
      label: "Open task",
      prompt: [
        { key: "title", label: "Task title" },
        { key: "goal", label: "Goal (optional)" },
      ],
      run: (ctx, args) => {
        const id = openTask(ctx.projectRoot, String(args?.title ?? ""), args?.goal as string | undefined);
        return id ? { ok: true } : { ok: false, error: "failed to create" };
      },
    },
    {
      id: "closeTask",
      label: "Close task",
      confirm: true,
      run: (ctx, args) => {
        const ok = closeTask(
          ctx.projectRoot,
          String(args?.taskId ?? ""),
          (args?.opts as CloseTaskOptions) ?? { outcomeTag: "done" },
        );
        return { ok, error: ok ? undefined : "close failed" };
      },
    },
    {
      id: "writeTokenMetric",
      label: "Write token metric",
      confirm: true,
      run: (ctx, args) => {
        const ok = writeTokenMetric(
          ctx.projectRoot,
          String(args?.taskId ?? ""),
          (args?.tokens as TaskTokens) ?? { used: 0, saved: 0 },
        );
        return { ok, error: ok ? undefined : "write failed" };
      },
    },
  ],
  // Declarative views (Task 7.4) -- reproduce TasksPanel (list) and TaskDetail (detail).
  views: {
    // TasksPanel: "{check|circle} {title.slice(0,60)}  {id}" -- gap=2 gives 2 spaces before the id.
    // DIFFERENCE: id is not dimColor (TableView colors the whole row/inversion) -- cosmetic.
    tasks: {
      kind: "table",
      source: { fn: "taskRows" },
      rowKey: "id",
      gap: 2,
      selectable: true,
      empty: "No tasks",
      onSelect: { openView: "taskDetail", passId: "id" },
      actions: [{ key: "o", actionId: "openTask" }],
      columns: [
        { value: "title", marker: { when: "status", equals: "closed", truthy: "✓", falsy: "○" } },
        { value: "id" },
      ],
    } satisfies ViewSpec,
    // TaskDetail: title + id, event sections, related sessions, the "Task tokens" block,
    // c/t/Esc legend. Sections/totals are built by display derivations (see derivations.ts).
    taskDetail: {
      kind: "detail",
      idParam: "taskId",
      title: { fn: "taskTitle", args: ["taskId"] },
      sections: [
        { label: "Decisions", items: { fn: "taskDecisions", args: ["taskId"] }, itemText: "text" },
        { label: "Findings", items: { fn: "taskFindings", args: ["taskId"] }, itemText: "text" },
        { label: "Rejected", items: { fn: "taskRejections", args: ["taskId"] }, itemText: "text" },
        {
          label: "Likely related sessions",
          note: "(time-based heuristic)",
          items: { fn: "relatedSessionLines", args: ["taskId"] },
          itemText: "text",
        },
        {
          label: "Task tokens",
          hideCount: true,
          lead: { fn: "taskTokensSummary", args: ["taskId"] },
          items: { fn: "taskTokenBreakdownLines", args: ["taskId"] },
          itemText: "text",
          empty: "no token data in task window",
          trailer: { fn: "taskRecordedMetricLine", args: ["taskId"] },
        },
      ],
      actions: [
        {
          key: "c",
          actionId: "closeTask",
          label: "close",
          confirmPrompt: "Close task? (y/n)",
          args: { taskId: "taskId" },
        },
        {
          key: "t",
          actionId: "writeTokenMetric",
          label: "write tokens",
          confirmPrompt: "Write token metric to journal? (y/n)",
          args: { taskId: "taskId", tokens: { fn: "tokensForTask", args: ["taskId"] } },
        },
      ],
    } satisfies ViewSpec,
  },
  // Single-plugin derivations -- contributed to the resolver's shared map ({fn} in views).
  // They know the task-journal event schema (TjEvent), operate over data.taskEvents.
  derivations: {
    taskDetail: (data, taskId) => taskDetailFromEvents(tjEvents(data), taskId as string),
    taskDecisions: (data, taskId) => eventLines(taskDetailFromEvents(tjEvents(data), taskId as string).decisions),
    taskFindings: (data, taskId) => eventLines(taskDetailFromEvents(tjEvents(data), taskId as string).findings),
    taskRejections: (data, taskId) => eventLines(taskDetailFromEvents(tjEvents(data), taskId as string).rejections),
    tokenMetrics: (data, taskId) => tokenMetricsFromEvents(tjEvents(data), taskId as string),
  },
};
