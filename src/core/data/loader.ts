import { loomRegistry } from "../plugins/index.js";
import { resolveProjectRoot, deriveProjectId } from "../workspace/project-id.js";
import { activeProject } from "../workspace/projects.js";
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
  projectId: string;
}

// Empty start: no plugin returned any useful data.
// We ignore health/errors -- health may come from sessions that never ran,
// and errors signal load failures, not the absence of configuration.
export function isWorkspaceEmpty(data: WorkspaceData): boolean {
  return (
    data.subscriptions.length === 0 &&
    data.sessions.length === 0 &&
    data.tokens.length === 0 &&
    data.taskEvents.length === 0 &&
    data.tasks.length === 0
  );
}

async function safe<T>(fn: () => T | Promise<T>, fallback: T, errors: string[], label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message}`);
    return fallback;
  }
}

// Load the aggregated 3-module workspace for a project. The root defaults to the
// active project (D3 registry), then the current working directory — so a
// multi-project host can load any project by passing its root.
export async function loadWorkspaceData(root?: string): Promise<WorkspaceData> {
  const errors: string[] = [];
  const base = root ?? activeProject()?.root ?? process.cwd();
  const projectRoot = resolveProjectRoot(base);
  const projectId = deriveProjectId(projectRoot);
  const ctx: LoomContext = { projectRoot };
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
    projectId,
  };
}
