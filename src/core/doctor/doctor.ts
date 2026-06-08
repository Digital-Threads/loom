import { existsSync, readFileSync } from "node:fs";
import { collectExpected } from "./collect.js";
import { diffSettings, mergeHooks, type HooksConfig } from "../merge/config-merge.js";
import { SCOPES, settingsPathForScope } from "./scope.js";
import type { DoctorReport, PluginContribution, ScopeDirs, ScopeName } from "./types.js";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function hookCollisions(
  contributions: PluginContribution[],
): Array<{ event: string; plugins: string[] }> {
  const byEvent = new Map<string, string[]>();
  for (const c of contributions) {
    for (const event of Object.keys(asRecord(c.hooks))) {
      const list = byEvent.get(event) ?? [];
      list.push(c.plugin);
      byEvent.set(event, list);
    }
  }
  const collisions: Array<{ event: string; plugins: string[] }> = [];
  for (const [event, plugins] of byEvent) {
    if (plugins.length > 1) collisions.push({ event, plugins });
  }
  return collisions;
}

export function diagnoseScope(
  scope: ScopeName,
  contributions: PluginContribution[],
  current: Record<string, unknown>,
): DoctorReport {
  const { expected, mcpCollisions } = collectExpected(contributions);

  // Compare current (before) vs expected (after) for MCP servers.
  const diff = diffSettings(current, expected as unknown as Record<string, unknown>);
  const missingMcp = diff.addedMcp;
  const changedMcp = diff.changedMcp;

  // Hook events expected but missing or differing on disk.
  // Normalize current through the same merge pass so key-order/dedup match expected.
  const currentHooks = mergeHooks([asRecord(current.hooks) as HooksConfig]);
  const missingHookEvents: string[] = [];
  for (const event of Object.keys(expected.hooks)) {
    if (JSON.stringify(currentHooks[event]) !== JSON.stringify(expected.hooks[event])) {
      missingHookEvents.push(event);
    }
  }

  const ok =
    missingMcp.length === 0 && changedMcp.length === 0 && missingHookEvents.length === 0;

  return {
    scope,
    ok,
    missingMcp,
    changedMcp,
    missingHookEvents,
    mcpCollisions,
    hookCollisions: hookCollisions(contributions),
  };
}

function readJson(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function diagnoseAll(
  contributions: PluginContribution[],
  dirs: ScopeDirs,
): DoctorReport[] {
  return SCOPES.map((scope) => {
    const current = readJson(settingsPathForScope(scope, dirs));
    return diagnoseScope(scope, contributions, current);
  });
}
