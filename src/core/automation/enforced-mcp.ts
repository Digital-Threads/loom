// Loom modules the agent must always have, regardless of which aimux profile it
// runs under. token-pilot is enforced via hooks (see enforced-settings.ts);
// task-journal is an MCP server. A NON-source profile runs under its own
// CLAUDE_CONFIG_DIR which does NOT carry the task-journal plugin, so the agent
// would lose the journal entirely. We write a tiny mcp-config and pass it with
// `--mcp-config` so the journal tools are present in every session. The source
// profile (~/.claude) already loads the plugin, so the caller skips it there to
// avoid a duplicate server.

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/** The MCP servers Loom guarantees to its agents. task-journal-mcp is the
 *  journal's stdio MCP binary (installed alongside the task-journal CLI). */
export const ENFORCED_MCP = {
  mcpServers: {
    "task-journal": { command: "task-journal-mcp" },
  },
};

let cachedPath: string | null = null;

/** Write the enforced mcp-config once and return its path, to pass to the agent
 *  launcher as `--mcp-config <path>`. Best-effort: a write failure still returns
 *  the path (a missing file just means no extra servers). */
export function enforcedMcpPath(): string {
  if (cachedPath) return cachedPath;
  const path = join(homedir(), ".loom", "enforced-mcp.json");
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(ENFORCED_MCP, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
  cachedPath = path;
  return path;
}
