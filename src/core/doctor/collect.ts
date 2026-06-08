import {
  mergeHooks,
  mergeMcpServers,
  pickStatusline,
  type HooksConfig,
} from "../merge/config-merge.js";
import type { PluginContribution } from "./types.js";

export interface ExpectedConfig {
  hooks: HooksConfig;
  mcpServers: Record<string, unknown>;
  statusLine: unknown;
}

export interface McpCollision {
  server: string;
  plugins: string[];
  values: unknown[];
}

export interface CollectResult {
  expected: ExpectedConfig;
  mcpCollisions: McpCollision[];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function collectExpected(contributions: PluginContribution[]): CollectResult {
  const hooks = mergeHooks(contributions.map((c) => (c.hooks ?? {}) as HooksConfig));
  const mcpServers = mergeMcpServers(
    contributions.map((c) => asRecord(c.mcpServers)),
  ).merged;
  const statusLine = pickStatusline(contributions.map((c) => c.statusLine));

  // Group server name -> ordered list of { plugin, value }.
  const byServer = new Map<string, Array<{ plugin: string; value: unknown }>>();
  for (const c of contributions) {
    const servers = asRecord(c.mcpServers);
    for (const name of Object.keys(servers)) {
      const list = byServer.get(name) ?? [];
      list.push({ plugin: c.plugin, value: servers[name] });
      byServer.set(name, list);
    }
  }

  const mcpCollisions: McpCollision[] = [];
  for (const [server, entries] of byServer) {
    const distinct = new Set(entries.map((e) => JSON.stringify(e.value)));
    if (distinct.size > 1) {
      mcpCollisions.push({
        server,
        plugins: entries.map((e) => e.plugin),
        values: entries.map((e) => e.value),
      });
    }
  }

  return { expected: { hooks, mcpServers, statusLine }, mcpCollisions };
}
