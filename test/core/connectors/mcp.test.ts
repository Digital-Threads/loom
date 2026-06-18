import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMcp, addMcp, toggleMcp, removeMcp, testMcp, mcpRunConfig, writeMcpRunConfig, type McpServer } from "../../../src/core/connectors/mcp.js";

const srv = (over: Partial<McpServer>): McpServer => ({ id: "x", command: "cmd", enabled: true, ...over });

let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "loom-mcp-")); file = join(dir, "mcp.json"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("MCP registry (D5.2)", () => {
  it("add/list/toggle/remove", () => {
    addMcp({ id: "fs", command: "mcp-fs", args: ["--root", "/"] }, file);
    expect(listMcp(file)).toHaveLength(1);
    expect(listMcp(file)[0]).toMatchObject({ id: "fs", enabled: true });
    expect(toggleMcp("fs", false, file)).toBe(true);
    expect(listMcp(file)[0].enabled).toBe(false);
    expect(toggleMcp("nope", true, file)).toBe(false);
    removeMcp("fs", file);
    expect(listMcp(file)).toEqual([]);
  });
  it("add is idempotent by id (replace)", () => {
    addMcp({ id: "x", command: "a" }, file);
    addMcp({ id: "x", command: "b" }, file);
    expect(listMcp(file)).toHaveLength(1);
    expect(listMcp(file)[0].command).toBe("b");
  });
  it("testMcp probes the command (injected)", () => {
    addMcp({ id: "ok", command: "good" }, file);
    expect(testMcp("ok", { file, probe: () => ({ code: 0 }) }).ok).toBe(true);
    expect(testMcp("ok", { file, probe: () => ({ code: 1 }) }).ok).toBe(false);
    expect(testMcp("ghost", { file, probe: () => ({ code: 0 }) }).ok).toBe(false);
  });
});

describe("mcpRunConfig — payload for the agent's --mcp-config", () => {
  it("keeps only enabled servers with a valid command", () => {
    const cfg = mcpRunConfig([
      srv({ id: "fs", command: "mcp-fs", args: ["--root", "/w"] }),
      srv({ id: "off", command: "nope", enabled: false }),
      srv({ id: "bad", command: "" as unknown as string }),
    ]);
    expect(Object.keys(cfg!.mcpServers)).toEqual(["fs"]);
    expect(cfg!.mcpServers.fs).toEqual({ command: "mcp-fs", args: ["--root", "/w"] });
  });
  it("omits args when the server has none, and drops non-string args", () => {
    const cfg = mcpRunConfig([srv({ id: "a", command: "c", args: ["ok", 1 as unknown as string] })]);
    expect(cfg!.mcpServers.a).toEqual({ command: "c", args: ["ok"] });
  });
  it("returns null when nothing is enabled/valid (zero behaviour change)", () => {
    expect(mcpRunConfig([])).toBeNull();
    expect(mcpRunConfig([srv({ enabled: false })])).toBeNull();
  });
  it("passes env for a stdio server, and omits it when empty/non-string", () => {
    const cfg = mcpRunConfig([
      srv({ id: "a", command: "c", env: { TOKEN: "x", N: 1 as unknown as string } }),
      srv({ id: "b", command: "c", env: {} }),
    ]);
    expect(cfg!.mcpServers.a).toEqual({ command: "c", env: { TOKEN: "x" } });
    expect(cfg!.mcpServers.b).toEqual({ command: "c" });
  });
  it("serializes a remote (sse/http) server as { type, url }", () => {
    const cfg = mcpRunConfig([
      srv({ id: "h", command: undefined, transport: "http", url: "https://host/mcp" }),
      srv({ id: "s", command: undefined, transport: "sse", url: "https://host/sse" }),
    ]);
    expect(cfg!.mcpServers.h).toEqual({ type: "http", url: "https://host/mcp" });
    expect(cfg!.mcpServers.s).toEqual({ type: "sse", url: "https://host/sse" });
  });
  it("drops a remote server with no url and a stdio server with no command", () => {
    const cfg = mcpRunConfig([
      srv({ id: "noUrl", command: undefined, transport: "http" }),
      srv({ id: "noCmd", command: undefined }),
      srv({ id: "ok", command: "c" }),
    ]);
    expect(Object.keys(cfg!.mcpServers)).toEqual(["ok"]);
  });
});

describe("addMcp — persists transport-specific fields", () => {
  it("stores env/args for stdio and stays idempotent by id", () => {
    addMcp({ id: "x", command: "c", args: ["--a"], env: { K: "v" } }, file);
    expect(listMcp(file)[0]).toMatchObject({ id: "x", command: "c", args: ["--a"], env: { K: "v" }, enabled: true });
    addMcp({ id: "x", command: "c2" }, file);
    expect(listMcp(file)).toHaveLength(1);
    expect(listMcp(file)[0].command).toBe("c2");
  });
  it("stores transport/url for a remote server and no command", () => {
    addMcp({ id: "r", transport: "sse", url: "https://h/sse" }, file);
    const s = listMcp(file)[0];
    expect(s).toMatchObject({ id: "r", transport: "sse", url: "https://h/sse", enabled: true });
    expect(s.command).toBeUndefined();
  });
  it("keeps back-compat: a plain {command,args} entry serializes unchanged", () => {
    addMcp({ id: "fs", command: "mcp-fs", args: ["--root", "/"] }, file);
    expect(mcpRunConfig(listMcp(file))!.mcpServers.fs).toEqual({ command: "mcp-fs", args: ["--root", "/"] });
  });
});

describe("writeMcpRunConfig — file-backed config (no argv blowup)", () => {
  it("writes the config to a file and returns its path", () => {
    const out = join(dir, "mcp.run.json");
    const p = writeMcpRunConfig([srv({ id: "fs", command: "mcp-fs" })], out);
    expect(p).toBe(out);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ mcpServers: { fs: { command: "mcp-fs" } } });
  });
  it("returns null and writes nothing when there is nothing to inject", () => {
    expect(writeMcpRunConfig([], join(dir, "none.json"))).toBeNull();
  });
});
