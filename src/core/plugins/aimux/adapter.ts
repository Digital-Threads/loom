import {
  loadConfig,
  checkAllProfiles,
  unifyAllSessions,
  type HealthReport,
} from "@digital-threads/aimux/core";

export interface Subscription {
  name: string;
  cli: string;
  isSource: boolean;
}

export function listSubscriptions(): Subscription[] {
  const cfg = loadConfig();
  if (!cfg) return [];
  return Object.entries(cfg.profiles).map(([name, p]) => ({
    name,
    cli: p.cli,
    isSource: Boolean(p.is_source),
  }));
}

export function listHealth(): HealthReport[] {
  const cfg = loadConfig();
  if (!cfg) return [];
  return Array.from(checkAllProfiles(cfg).values());
}

export interface SessionRow {
  sessionId: string;
  profile: string;
  lastUsedAtMs?: number;
}

export function listSessions(): SessionRow[] {
  const cfg = loadConfig();
  if (!cfg) return [];
  return unifyAllSessions(cfg).map((s) => ({
    sessionId: s.sessionId,
    profile: s.lastProfile ?? "",
    lastUsedAtMs: s.updatedAtMs,
  }));
}
