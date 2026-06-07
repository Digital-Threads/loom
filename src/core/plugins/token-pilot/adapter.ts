import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SettingsSchema } from "../types.js";

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

export interface TokenEvent {
  sessionId: string;
  used: number;
  saved: number;
  ts: number;
}

export function tokenEventsByTime(projectRoot: string): TokenEvent[] {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, ".token-pilot", "hook-events.jsonl"), "utf8");
  } catch {
    return [];
  }

  const events: TokenEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: { session_id?: unknown; estTokens?: unknown; savedTokens?: unknown; ts?: unknown };
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const sessionId = ev.session_id;
    if (typeof sessionId !== "string" || sessionId === "diagnostic") continue;
    const ts = ev.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    const used = typeof ev.estTokens === "number" ? ev.estTokens : 0;
    const saved = typeof ev.savedTokens === "number" ? ev.savedTokens : 0;
    events.push({ sessionId, used, saved, ts });
  }

  return events;
}

export function settingsSchema(): SettingsSchema {
  return {
    fields: [
      { key: "hooks.mode", label: "Режим хуков", type: "enum", options: ["off", "advisory", "deny-enhanced"] },
      { key: "hooks.denyThreshold", label: "Порог строк для deny", type: "number" },
      { key: "sessionStart.enabled", label: "Напоминание при старте сессии", type: "boolean" },
      { key: "smartRead.smallFileThreshold", label: "Порог малого файла (строк)", type: "number" },
      { key: "cache.maxSizeMB", label: "Размер кэша (МБ)", type: "number" },
      { key: "updates.checkOnStartup", label: "Проверять обновления при старте", type: "boolean" },
    ],
  };
}

function getDotted(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setDotted(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cur[k];
    if (next === null || typeof next !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export function readSettings(projectRoot: string): Record<string, unknown> {
  try {
    const raw = readFileSync(join(projectRoot, ".token-pilot.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function settingValue(projectRoot: string, key: string): unknown {
  return getDotted(readSettings(projectRoot), key);
}

// updates keyed by dotted path; deep-merges into existing .token-pilot.json,
// preserving all other keys. Returns false on any I/O error.
export function writeSettings(projectRoot: string, updates: Record<string, unknown>): boolean {
  try {
    const current = readSettings(projectRoot);
    for (const [path, value] of Object.entries(updates)) setDotted(current, path, value);
    writeFileSync(
      join(projectRoot, ".token-pilot.json"),
      JSON.stringify(current, null, 2) + "\n",
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}
