// D5.2 — MCP connector registry. Loom stores the user's MCP servers and passes
// the enabled ones into agent sessions (via aimux). v1: list/add/toggle/remove/
// test — no OAuth. File-backed (~/.loom/mcp.json); injectable for tests.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loomDataDir } from "../paths.js";

export interface McpServer {
  id: string;
  command: string;
  args?: string[];
  enabled: boolean;
}

interface McpFile {
  version: 1;
  servers: McpServer[];
}

export function mcpFile(): string {
  return join(loomDataDir(), "mcp.json");
}

function read(file: string): McpFile {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<McpFile>;
    return { version: 1, servers: Array.isArray(raw.servers) ? (raw.servers as McpServer[]) : [] };
  } catch {
    return { version: 1, servers: [] };
  }
}

function write(file: string, data: McpFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function listMcp(file: string = mcpFile()): McpServer[] {
  return read(file).servers;
}

export function addMcp(
  input: { id: string; command: string; args?: string[] },
  file: string = mcpFile(),
): McpServer {
  const data = read(file);
  const server: McpServer = { id: input.id, command: input.command, args: input.args, enabled: true };
  const idx = data.servers.findIndex((s) => s.id === input.id);
  if (idx >= 0) data.servers[idx] = server;
  else data.servers.push(server);
  write(file, data);
  return server;
}

export function toggleMcp(id: string, enabled: boolean, file: string = mcpFile()): boolean {
  const data = read(file);
  const s = data.servers.find((x) => x.id === id);
  if (!s) return false;
  s.enabled = enabled;
  write(file, data);
  return true;
}

export function removeMcp(id: string, file: string = mcpFile()): void {
  const data = read(file);
  data.servers = data.servers.filter((s) => s.id !== id);
  write(file, data);
}

export type McpProbe = (command: string, args: string[]) => { code: number };

/** Test an MCP server is reachable: probe `command --help` (injectable). */
export function testMcp(id: string, opts: { file?: string; probe?: McpProbe } = {}): { ok: boolean; error?: string } {
  const server = listMcp(opts.file).find((s) => s.id === id);
  if (!server) return { ok: false, error: "unknown server" };
  if (!opts.probe) return { ok: false, error: "no probe configured" };
  try {
    return { ok: opts.probe(server.command, [...(server.args ?? []), "--help"]).code === 0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
