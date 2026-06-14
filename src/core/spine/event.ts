// Unified Loom event — the single shape every layer's activity is normalized to
// before it hits the event bus / core store. Modeled on the shared event format
// in plan.md §6, trimmed to what we actually use today.

export type LoomEventSource = "loom" | "token-pilot" | "task-journal" | "aimux";

export interface LoomEvent {
  schema: "loom.event.v1";
  /** Optional stable id; absent for derived/normalized events. */
  id?: string;
  /** epoch milliseconds. */
  ts: number;
  source: LoomEventSource;
  projectId: string;
  profileId?: string;
  taskId?: string;
  workflowId?: string;
  /** Source-specific kind, e.g. "tokens" | "session" | "decision" | "stage". */
  type: string;
  severity?: "info" | "warn" | "error";
  /** Numeric metrics, e.g. { used, saved, durationMs }. */
  metrics?: Record<string, number>;
  message?: string;
}

/** Build a LoomEvent, stamping the schema so call sites never repeat it. */
export function makeEvent(e: Omit<LoomEvent, "schema">): LoomEvent {
  return { schema: "loom.event.v1", ...e };
}
