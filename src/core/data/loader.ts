import { listSubscriptions, listSessions, listHealth } from "../plugins/aimux/adapter.js";
import { tokenUsageBySession, type TokenUsageRow } from "../plugins/token-pilot/adapter.js";
import { loadTaskEvents, tasksFromEvents, type TjEvent, type TaskSummary } from "../plugins/task-journal/adapter.js";

export interface WorkspaceData {
  subscriptions: ReturnType<typeof listSubscriptions>;
  sessions: ReturnType<typeof listSessions>;
  health: Awaited<ReturnType<typeof listHealth>>;
  tokens: TokenUsageRow[];
  taskEvents: TjEvent[];
  tasks: TaskSummary[];
  errors: string[];
}

async function safe<T>(fn: () => T | Promise<T>, fallback: T, errors: string[], label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message}`);
    return fallback;
  }
}

export async function loadWorkspaceData(): Promise<WorkspaceData> {
  const errors: string[] = [];
  const [subscriptions, sessions, health, tokens, taskEvents] = await Promise.all([
    safe(() => listSubscriptions(), [], errors, "subscriptions"),
    safe(() => listSessions(), [], errors, "sessions"),
    safe(() => listHealth(), [], errors, "health"),
    safe(() => tokenUsageBySession(process.cwd()), [], errors, "tokens"),
    safe(() => loadTaskEvents(process.cwd()), [], errors, "tasks"),
  ]);
  const tasks = tasksFromEvents(taskEvents);
  return { subscriptions, sessions, health, tokens, taskEvents, tasks, errors };
}
