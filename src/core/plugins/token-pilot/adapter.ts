import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface TokenUsageRow {
  sessionId: string;
  used: number;
  saved: number;
}

export function tokenUsageBySession(projectRoot: string): TokenUsageRow[] {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, ".token-pilot", "hook-events.jsonl"), "utf8");
  } catch {
    return [];
  }

  const bySession = new Map<string, TokenUsageRow>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: { session_id?: unknown; estTokens?: unknown; savedTokens?: unknown };
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const sessionId = ev.session_id;
    if (typeof sessionId !== "string" || sessionId === "diagnostic") continue;
    const used = typeof ev.estTokens === "number" ? ev.estTokens : 0;
    const saved = typeof ev.savedTokens === "number" ? ev.savedTokens : 0;
    const row = bySession.get(sessionId) ?? { sessionId, used: 0, saved: 0 };
    row.used += used;
    row.saved += saved;
    bySession.set(sessionId, row);
  }

  return Array.from(bySession.values()).sort((a, b) => b.saved - a.saved);
}
