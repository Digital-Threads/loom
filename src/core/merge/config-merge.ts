import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

// ── Types ───────────────────────────────────────────────────────────────────

export interface HookCommand {
  type?: string;
  command: string;
  [k: string]: unknown;
}

export interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

export type HooksConfig = Record<string, HookEntry[]>; // event -> entries

export interface McpMergeResult {
  merged: Record<string, unknown>;
  collisions: string[]; // server names present in >1 source with a DIFFERENT value
}

export interface SettingsDiff {
  addedMcp: string[];
  changedMcp: string[];
  hookEventsTouched: string[];
  statuslineChanged: boolean;
  text: string;
}

export interface MergeOptions {
  apply: boolean;
  backupPath?: string;
  statuslinePriority?: number;
}

export interface MergeRunResult {
  diff: SettingsDiff;
  applied: boolean;
  backupPath: string | null;
  collisions: string[];
}

// ── Pure merge functions ─────────────────────────────────────────────────────

function hookKey(h: HookCommand): string {
  return `${h.type ?? "command"}::${h.command}`;
}

// UNION hooks across sources. Within one event, group by matcher (undefined → ""),
// merge hooks, dedup by `${type ?? "command"}::${command}`. One entry per matcher.
// Preserve first-appearance order of matchers and commands.
export function mergeHooks(sources: HooksConfig[]): HooksConfig {
  const result: HooksConfig = {};
  // event -> matcher -> { entry, seenKeys }
  const groups: Record<string, Map<string, { entry: HookEntry; seen: Set<string> }>> = {};

  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const event of Object.keys(src)) {
      const entries = src[event];
      if (!Array.isArray(entries)) continue;
      if (!groups[event]) groups[event] = new Map();
      const byMatcher = groups[event];

      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const matcherKey = entry.matcher ?? "";
        let group = byMatcher.get(matcherKey);
        if (!group) {
          group = {
            entry: { hooks: [] },
            seen: new Set<string>(),
          };
          if (entry.matcher !== undefined) group.entry.matcher = entry.matcher;
          byMatcher.set(matcherKey, group);
        }
        const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
        for (const h of hooks) {
          if (!h || typeof h !== "object") continue;
          const k = hookKey(h);
          if (group.seen.has(k)) continue;
          group.seen.add(k);
          group.entry.hooks.push(h);
        }
      }
    }
  }

  for (const event of Object.keys(groups)) {
    result[event] = [...groups[event].values()].map((g) => g.entry);
  }
  return result;
}

// UNION mcpServers by name; on collision (name in >1 source with different JSON) → last-wins.
export function mergeMcpServers(sources: Record<string, unknown>[]): McpMergeResult {
  const merged: Record<string, unknown> = {};
  const serialized: Record<string, string> = {};
  const collisions = new Set<string>();

  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const name of Object.keys(src)) {
      const value = src[name];
      const ser = JSON.stringify(value);
      if (name in merged && serialized[name] !== ser) {
        collisions.add(name);
      }
      merged[name] = value;
      serialized[name] = ser;
    }
  }

  return { merged, collisions: [...collisions] };
}

// statusLine — scalar: first non-undefined/non-null candidate in priority order.
export function pickStatusline(candidates: Array<unknown>): unknown {
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c;
  }
  return undefined;
}

// ── Diff ─────────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function hookSignature(entries: unknown): string {
  if (!Array.isArray(entries)) return JSON.stringify(entries ?? null);
  const totalHooks = entries.reduce(
    (sum, e) => sum + (Array.isArray((e as HookEntry)?.hooks) ? (e as HookEntry).hooks.length : 0),
    0,
  );
  return `${entries.length}:${totalHooks}:${JSON.stringify(entries)}`;
}

export function diffSettings(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): SettingsDiff {
  const beforeMcp = asRecord(before.mcpServers);
  const afterMcp = asRecord(after.mcpServers);

  const addedMcp: string[] = [];
  const changedMcp: string[] = [];
  for (const name of Object.keys(afterMcp)) {
    if (!(name in beforeMcp)) {
      addedMcp.push(name);
    } else if (JSON.stringify(beforeMcp[name]) !== JSON.stringify(afterMcp[name])) {
      changedMcp.push(name);
    }
  }

  const beforeHooks = asRecord(before.hooks);
  const afterHooks = asRecord(after.hooks);
  const hookEventsTouched: string[] = [];
  const allEvents = new Set([...Object.keys(beforeHooks), ...Object.keys(afterHooks)]);
  for (const event of allEvents) {
    if (hookSignature(beforeHooks[event]) !== hookSignature(afterHooks[event])) {
      hookEventsTouched.push(event);
    }
  }

  const statuslineChanged =
    JSON.stringify(before.statusLine) !== JSON.stringify(after.statusLine);

  const lines: string[] = [];
  for (const name of addedMcp) lines.push(`+ mcp: ${name}`);
  for (const name of changedMcp) lines.push(`~ mcp: ${name} (изменён)`);
  for (const event of hookEventsTouched) lines.push(`~ hooks: ${event}`);
  if (statuslineChanged) lines.push(`~ statusLine`);

  const text = lines.length > 0 ? lines.join("\n") : "нет изменений";

  return { addedMcp, changedMcp, hookEventsTouched, statuslineChanged, text };
}

// ── File orchestrator ─────────────────────────────────────────────────────────

function readJsonDefensive(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function mergeConfigs(
  targetPath: string,
  sourcePaths: string[],
  opts: MergeOptions,
): MergeRunResult {
  const target = readJsonDefensive(targetPath);
  const sources = sourcePaths
    .filter((p) => existsSync(p))
    .map((p) => readJsonDefensive(p));

  const mcp = mergeMcpServers([
    asRecord(target.mcpServers),
    ...sources.map((s) => asRecord(s.mcpServers)),
  ]);

  const hooks = mergeHooks([
    target.hooks as HooksConfig,
    ...sources.map((s) => s.hooks as HooksConfig),
  ]);

  const statusLine = pickStatusline([
    target.statusLine,
    ...sources.map((s) => s.statusLine),
  ]);

  const merged: Record<string, unknown> = {
    ...target,
    mcpServers: mcp.merged,
    hooks,
  };
  if (statusLine !== undefined) {
    merged.statusLine = statusLine;
  } else {
    delete merged.statusLine;
  }

  const diff = diffSettings(target, merged);

  let backupPath: string | null = null;
  if (opts.apply) {
    const targetExists = existsSync(targetPath);
    const bak = opts.backupPath ?? `${targetPath}.bak`;
    if (targetExists) {
      copyFileSync(targetPath, bak);
      backupPath = bak;
    }
    writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }

  return {
    diff,
    applied: opts.apply,
    backupPath,
    collisions: mcp.collisions,
  };
}
