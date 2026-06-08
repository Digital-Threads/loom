import type { TjEvent } from "../plugins/task-journal/adapter.js";
import type { SessionRow } from "../plugins/aimux/adapter.js";
import type { TokenUsageRow } from "../plugins/token-pilot/adapter.js";

export interface RelatedSession {
  sessionId: string;
  profile: string;
  lastUsedAtMs: number;
  used: number;
  saved: number;
}

/**
 * Heuristic, non-owning correlation: sessions whose lastUsedAtMs falls within
 * the task's event-time window [min..max]. NOT ownership — a soft timeline hint.
 */
export function relatedSessions(
  allEvents: TjEvent[],
  taskId: string,
  sessions: SessionRow[],
  tokens: TokenUsageRow[],
): RelatedSession[] {
  const own = allEvents.filter((e) => e.task_id === taskId);
  if (own.length === 0) return [];

  let startMs = Infinity;
  let endMs = -Infinity;
  for (const e of own) {
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms < startMs) startMs = ms;
    if (ms > endMs) endMs = ms;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const tokById = new Map(tokens.map((t) => [t.sessionId, t]));
  const result: RelatedSession[] = [];
  for (const s of sessions) {
    if (typeof s.lastUsedAtMs !== "number") continue;
    if (s.lastUsedAtMs < startMs || s.lastUsedAtMs > endMs) continue;
    const tk = tokById.get(s.sessionId);
    result.push({
      sessionId: s.sessionId,
      profile: s.profile,
      lastUsedAtMs: s.lastUsedAtMs,
      used: tk?.used ?? 0,
      saved: tk?.saved ?? 0,
    });
  }
  result.sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);
  return result;
}
