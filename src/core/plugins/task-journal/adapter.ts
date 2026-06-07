import { execFileSync } from "node:child_process";

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
