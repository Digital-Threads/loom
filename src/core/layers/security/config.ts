// Host-injected configuration for the security layer. The package is one-way
// (knows nothing about Loom) but two things are host concerns: WHERE worktrees
// live, and HOW audit events reach the event bus. The host calls
// configureSecurity() once at startup; defaults keep the package usable
// standalone (own ~/.loom data dir, no-op audit sink).
import { homedir } from "node:os";
import { join } from "node:path";

/** A security audit event — same shape as a Loom event-bus event, so the host's
 *  bus sink accepts it directly (structural typing). */
export interface AuditEvent {
  schema: "loom.event.v1";
  ts: number;
  source: "loom";
  projectId: string;
  taskId?: string;
  workflowId?: string;
  type: string;
  severity?: "info" | "warn" | "error";
  metrics?: Record<string, number>;
  message?: string;
}

type Emit = (projectId: string, event: AuditEvent) => void;

let _dataDir: () => string = () => {
  const xdg = process.env.XDG_DATA_HOME;
  return xdg ? join(xdg, "loom") : join(homedir(), ".loom");
};
let _emit: Emit = () => {}; // no-op until the host wires the event bus

/** Wire host specifics: the data dir (worktree base) and the audit event sink. */
export function configureSecurity(opts: { dataDir?: () => string; emit?: Emit }): void {
  if (opts.dataDir) _dataDir = opts.dataDir;
  if (opts.emit) _emit = opts.emit;
}

export function securityDataDir(): string { return _dataDir(); }
export function emitAudit(projectId: string, event: AuditEvent): void { _emit(projectId, event); }
