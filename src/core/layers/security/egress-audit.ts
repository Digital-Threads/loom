// Turns the egress proxy's raw onHost callbacks into deduped audit events. One
// `audit.egress.observed` per distinct destination (not per connection), and a
// running set of hosts the host process can persist as the task's egress record
// — the raw material for the Phase 2 allowlist.

import { emitAudit } from "./config.js";

export interface EgressObserver {
  /** Wire this as the egress proxy's onHost. */
  onHost: (host: string, port: number) => void;
  /** Distinct "host:port" destinations seen so far. */
  hosts: () => string[];
}

export function createEgressObserver(ids: { projectId: string; taskId?: string }): EgressObserver {
  const seen = new Set<string>();
  return {
    onHost: (host, port) => {
      const key = `${host}:${port}`;
      if (seen.has(key)) return; // already audited this destination
      seen.add(key);
      emitAudit(ids.projectId, {
        schema: "loom.event.v1",
        ts: Date.now(),
        source: "loom",
        projectId: ids.projectId,
        taskId: ids.taskId,
        type: "audit.egress.observed",
        severity: "info",
        message: `egress → ${key}`,
      });
    },
    hosts: () => [...seen],
  };
}
