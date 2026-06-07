import { loomRegistry } from "../plugins/index.js";
import type { LoomContext } from "../plugins/types.js";
import type { TokenUsageRow, TokenEvent } from "../plugins/token-pilot/adapter.js";
import type { TjEvent, TaskSummary } from "../plugins/task-journal/adapter.js";
import type { listSubscriptions, listSessions, listHealth } from "../plugins/aimux/adapter.js";

export interface WorkspaceData {
  subscriptions: ReturnType<typeof listSubscriptions>;
  sessions: ReturnType<typeof listSessions>;
  health: Awaited<ReturnType<typeof listHealth>>;
  tokens: TokenUsageRow[];
  tokenEvents: TokenEvent[];
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
  const ctx: LoomContext = { projectRoot: process.cwd() };
  const slices = await Promise.all(
    loomRegistry.list().map((p) =>
      safe(() => p.load(ctx), {} as Record<string, unknown>, errors, p.id),
    ),
  );
  const merged = Object.assign({}, ...slices) as Partial<WorkspaceData>;
  return {
    subscriptions: merged.subscriptions ?? [],
    sessions: merged.sessions ?? [],
    health: merged.health ?? [],
    tokens: merged.tokens ?? [],
    tokenEvents: merged.tokenEvents ?? [],
    taskEvents: merged.taskEvents ?? [],
    tasks: merged.tasks ?? [],
    errors,
  };
}
