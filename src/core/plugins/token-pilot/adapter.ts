import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SettingsSchema, LoomPlugin, ViewSpec } from "../contract.js";

export interface TokenUsageRow {
  sessionId: string;
  used: number;
  saved: number;
}

// текущий hook-events.jsonl + ротированные архивы hook-events.<digits>.jsonl
const ARCHIVE_RE = /^hook-events\.\d+\.jsonl$/;
// тяжёлые каталоги, в которые рекурсивный обход не заходит
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target"]);
const MAX_DEPTH = 6;

// рекурсивно собирает абсолютные пути всех hook-events*.jsonl во всех
// каталогах .token-pilot ниже projectRoot (включая сам projectRoot/.token-pilot),
// пропуская тяжёлые каталоги и ограничивая глубину. Defensive: ошибки I/O → skip.
function collectHookEventFiles(projectRoot: string): string[] {
  const files: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.name === ".token-pilot") {
        addJsonlFiles(full);
        continue;
      }
      walk(full, depth + 1);
    }
  }

  function addJsonlFiles(tpDir: string): void {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(tpDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name === "hook-events.jsonl" || ARCHIVE_RE.test(entry.name)) {
        files.push(join(tpDir, entry.name));
      }
    }
  }

  walk(projectRoot, 0);
  return files;
}

interface RawHookEvent {
  session_id?: unknown;
  agent_type?: unknown;
  estTokens?: unknown;
  savedTokens?: unknown;
  ts?: unknown;
}

// читает и построчно парсит все hook-events*.jsonl из всех .token-pilot
// поддеревьев. Defensive: битые строки/файлы пропускаются. diagnostic-сессии
// отфильтрованы здесь. Возвращает уже отфильтрованные сырые события.
function readHookEvents(projectRoot: string): RawHookEvent[] {
  const out: RawHookEvent[] = [];
  for (const file of collectHookEventFiles(projectRoot)) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev: RawHookEvent;
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const sessionId = ev.session_id;
      if (typeof sessionId !== "string" || sessionId === "diagnostic") continue;
      out.push(ev);
    }
  }
  return out;
}

export function tokenUsageBySession(projectRoot: string): TokenUsageRow[] {
  const bySession = new Map<string, TokenUsageRow>();
  for (const ev of readHookEvents(projectRoot)) {
    const sessionId = ev.session_id as string;
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
  agentType: string | null;
}

export function tokenEventsByTime(projectRoot: string): TokenEvent[] {
  const events: TokenEvent[] = [];
  for (const ev of readHookEvents(projectRoot)) {
    const ts = ev.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    const sessionId = ev.session_id as string;
    const used = typeof ev.estTokens === "number" ? ev.estTokens : 0;
    const saved = typeof ev.savedTokens === "number" ? ev.savedTokens : 0;
    const agentType = typeof ev.agent_type === "string" ? ev.agent_type : null;
    events.push({ sessionId, used, saved, ts, agentType });
  }

  return events.sort((a, b) => a.ts - b.ts);
}

export function settingsSchema(): SettingsSchema {
  return {
    fields: [
      { key: "hooks.mode", label: "Hook mode", type: "enum", options: ["off", "advisory", "deny-enhanced"] },
      { key: "hooks.denyThreshold", label: "Line threshold for deny", type: "number" },
      { key: "sessionStart.enabled", label: "Reminder at session start", type: "boolean" },
      { key: "smartRead.smallFileThreshold", label: "Small file threshold (lines)", type: "number" },
      { key: "cache.maxSizeMB", label: "Cache size (MB)", type: "number" },
      { key: "updates.checkOnStartup", label: "Check for updates on startup", type: "boolean" },
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

// plugin-объект собран из существующих функций выше — без новой логики.
export const plugin: LoomPlugin<{
  tokens: TokenUsageRow[];
  tokenEvents: TokenEvent[];
}> = {
  id: "token-pilot",
  title: "token-pilot",
  category: "efficiency",
  capabilities: { install: false, data: true, settings: true, actions: false },
  tabs: [{ id: "tokens", title: "Tokens" }],
  load: (ctx) => ({
    tokens: tokenUsageBySession(ctx.projectRoot),
    tokenEvents: tokenEventsByTime(ctx.projectRoot),
  }),
  settings: {
    schema: settingsSchema(),
    read: (ctx) => readSettings(ctx.projectRoot),
    write: (ctx, updates) => writeSettings(ctx.projectRoot, updates),
  },
  actions: [],
  // TokensPanel = составной экран: итоговая строка + таблица. when:"tokens.length"
  // прячет итог при пустых токенах — тогда видна только пустышка таблицы (как в панели).
  views: {
    tokens: [
      {
        kind: "summary",
        lines: [{ label: "Total", value: { fn: "tokenTotalsLine" }, when: "tokens.length" }],
      },
      {
        kind: "table",
        source: { fn: "tokenRows" },
        rowKey: "sessionId",
        gap: 2,
        empty: "No token data",
        columns: [
          { value: "idShort" },
          { value: "used", width: 8, align: "right" },
          { value: "saved", width: 8, align: "right" },
        ],
      },
    ] satisfies ViewSpec[],
  },
};
