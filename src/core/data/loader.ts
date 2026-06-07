import { listSubscriptions, listSessions, listHealth } from "../plugins/aimux/adapter.js";

export interface WorkspaceData {
  subscriptions: ReturnType<typeof listSubscriptions>;
  sessions: ReturnType<typeof listSessions>;
  health: Awaited<ReturnType<typeof listHealth>>;
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
  const [subscriptions, sessions, health] = await Promise.all([
    safe(() => listSubscriptions(), [], errors, "subscriptions"),
    safe(() => listSessions(), [], errors, "sessions"),
    safe(() => listHealth(), [], errors, "health"),
  ]);
  return { subscriptions, sessions, health, errors };
}
