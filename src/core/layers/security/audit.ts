// Security audit trail — blocked/warned commands, secret findings, and worktree
// lifecycle land on the event bus as `audit.*` events (projected into the store
// for the timeline). Never carries a raw secret (only redacted previews). The
// bus sink is injected (configureSecurity); standalone it's a no-op.

import { type AuditEvent, emitAudit } from "./config.js";

export type AuditKind =
  | "command.blocked"
  | "command.warned"
  | "secret.found"
  | "worktree.created"
  | "worktree.removed"
  | "plugin.verify";

export interface AuditEntry {
  projectId: string;
  taskId?: string;
  workflowId?: string;
  kind: AuditKind;
  message: string;
  metrics?: Record<string, number>;
}

/** Build an `audit.<kind>` event (severity warn). */
export function auditEvent(e: AuditEntry): AuditEvent {
  return {
    schema: "loom.event.v1",
    ts: Date.now(),
    source: "loom",
    projectId: e.projectId,
    taskId: e.taskId,
    workflowId: e.workflowId,
    type: `audit.${e.kind}`,
    severity: "warn",
    message: e.message,
    metrics: e.metrics,
  };
}

/** Append an audit event to the project's bus (via the injected sink). */
export function audit(e: AuditEntry): AuditEvent {
  const ev = auditEvent(e);
  emitAudit(e.projectId, ev);
  return ev;
}
