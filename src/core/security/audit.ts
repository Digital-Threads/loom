// Security audit trail — blocked/warned commands, secret findings, and worktree
// lifecycle land on the event bus as `audit.*` LoomEvents (projected into the
// store for the timeline). Never carries a raw secret (only redacted previews).

import { makeEvent, type LoomEvent } from "../spine/event.js";
import { appendLoomEvent } from "../spine/event-bus.js";

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

/** Build an `audit.<kind>` LoomEvent (severity warn). */
export function auditEvent(e: AuditEntry): LoomEvent {
  return makeEvent({
    ts: Date.now(),
    source: "loom",
    projectId: e.projectId,
    taskId: e.taskId,
    workflowId: e.workflowId,
    type: `audit.${e.kind}`,
    severity: "warn",
    message: e.message,
    metrics: e.metrics,
  });
}

/** Append an audit event to the project's bus. */
export function audit(e: AuditEntry): LoomEvent {
  const ev = auditEvent(e);
  appendLoomEvent(e.projectId, ev);
  return ev;
}
