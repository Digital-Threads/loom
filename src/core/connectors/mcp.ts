// D5.2 — MCP connector registry. Loom stores the user's MCP servers and passes
// the enabled ones into agent sessions (via aimux). v1: list/add/toggle/remove/
// test — no OAuth. File-backed (~/.loom/mcp.json); injectable for tests.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loomDataDir } from "../paths.js";

export type McpTransport = "stdio" | "sse" | "http";

export interface McpServer {
  id: string;
  /** stdio: the executable to spawn. Optional because a remote server has a
   *  url instead. */
  command?: string;
  args?: string[];
  /** Environment passed to a stdio server's process. */
  env?: Record<string, string>;
  /** Absent == "stdio" (back-compat with pre-remote registries). */
  transport?: McpTransport;
  /** Endpoint for an sse/http (remote) server. */
  url?: string;
  enabled: boolean;
}

/** A remote server is one whose transport speaks over a URL (sse/http). */
function isRemote(s: McpServer): boolean {
  return s.transport === "sse" || s.transport === "http";
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
  input: {
    id: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    transport?: McpTransport;
    url?: string;
  },
  file: string = mcpFile(),
): McpServer {
  const data = read(file);
  const remote = input.transport === "sse" || input.transport === "http";
  // Persist only the fields that make sense for the chosen transport so the
  // registry stays clean (no stray command on a remote server, no url on stdio).
  const server: McpServer = { id: input.id, enabled: true };
  if (remote) {
    server.transport = input.transport;
    if (input.url) server.url = input.url;
  } else {
    if (input.transport) server.transport = input.transport;
    if (input.command) server.command = input.command;
    if (input.args && input.args.length) server.args = input.args;
    if (input.env && Object.keys(input.env).length) server.env = input.env;
  }
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

/** Path of the generated run-config handed to the agent via `--mcp-config`. */
export function mcpRunConfigFile(): string {
  return join(loomDataDir(), "mcp.run.json");
}

/** A single server entry in the Claude `--mcp-config` payload: a stdio process
 *  (command/args/env) or a remote endpoint (type/url). */
type RunStdio = { command: string; args?: string[]; env?: Record<string, string> };
type RunRemote = { type: "sse" | "http"; url: string };
export type McpRunServer = RunStdio | RunRemote;

/** Keep only string→string pairs; return undefined when nothing valid is left
 *  so a missing/empty env never changes the stdio output shape. */
function sanitizeEnv(env: unknown): Record<string, string> | undefined {
  if (!env || typeof env !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof k === "string" && k && typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Build the Claude `--mcp-config` payload from the registry: only enabled,
 *  valid servers. stdio needs a non-empty command; remote (sse/http) needs a
 *  url. The registry file is user-editable, so every field is validated here —
 *  a malformed entry is dropped rather than written out as a broken server.
 *  Returns null when there is nothing to inject (zero behaviour change). */
export function mcpRunConfig(
  servers: McpServer[],
): { mcpServers: Record<string, McpRunServer> } | null {
  const mcpServers: Record<string, McpRunServer> = {};
  for (const s of servers) {
    if (!s || !s.enabled) continue;
    if (typeof s.id !== "string" || !s.id) continue;
    if (isRemote(s)) {
      if (typeof s.url !== "string" || !s.url) continue;
      mcpServers[s.id] = { type: s.transport as "sse" | "http", url: s.url };
      continue;
    }
    if (typeof s.command !== "string" || !s.command) continue;
    const args = Array.isArray(s.args) ? s.args.filter((a) => typeof a === "string") : undefined;
    const env = sanitizeEnv(s.env);
    const entry: RunStdio = { command: s.command };
    if (args && args.length) entry.args = args;
    if (env) entry.env = env;
    mcpServers[s.id] = entry;
  }
  return Object.keys(mcpServers).length ? { mcpServers } : null;
}

/** Write the run-config to a file and return its path (passed to the agent as
 *  `--mcp-config <path>`). A FILE — not inline JSON — so a large registry can
 *  never blow the argv length limit (E2BIG) and take down the whole spawn, and
 *  so it works regardless of whether the CLI accepts inline JSON. Returns null
 *  when there is nothing to inject. */
export function writeMcpRunConfig(servers: McpServer[], file: string = mcpRunConfigFile()): string | null {
  const cfg = mcpRunConfig(servers);
  if (!cfg) return null;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
  return file;
}

export type McpProbe = (command: string, args: string[]) => { code: number };

/** Test an MCP server is reachable: probe `command --help` (injectable). */
export function testMcp(id: string, opts: { file?: string; probe?: McpProbe } = {}): { ok: boolean; error?: string } {
  const server = listMcp(opts.file).find((s) => s.id === id);
  if (!server) return { ok: false, error: "unknown server" };
  // Remote servers have no command to probe — reachability would need an HTTP
  // call we don't make here; report it plainly instead of crashing.
  if (isRemote(server)) return { ok: false, error: "remote test not supported" };
  if (!server.command) return { ok: false, error: "no command configured" };
  if (!opts.probe) return { ok: false, error: "no probe configured" };
  try {
    return { ok: opts.probe(server.command, [...(server.args ?? []), "--help"]).code === 0 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
