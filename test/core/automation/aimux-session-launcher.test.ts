import { describe, it, expect } from "vitest";
import { mcpConfigArgs } from "../../../src/core/automation/aimux-session-launcher.js";
import type { McpServer } from "../../../src/core/connectors/mcp.js";

const srv = (over: Partial<McpServer>): McpServer => ({ id: "x", command: "cmd", enabled: true, ...over });

describe("mcpConfigArgs — enabled MCP servers reach the agent session", () => {
  it("emits --mcp-config with only the enabled servers", () => {
    const args = mcpConfigArgs([
      srv({ id: "fs", command: "mcp-fs", args: ["--root", "/w"] }),
      srv({ id: "off", command: "nope", enabled: false }),
    ]);
    expect(args[0]).toBe("--mcp-config");
    const cfg = JSON.parse(args[1]) as { mcpServers: Record<string, { command: string; args?: string[] }> };
    expect(Object.keys(cfg.mcpServers)).toEqual(["fs"]);
    expect(cfg.mcpServers.fs).toEqual({ command: "mcp-fs", args: ["--root", "/w"] });
  });

  it("omits args when the server has none", () => {
    const cfg = JSON.parse(mcpConfigArgs([srv({ id: "a", command: "c" })])[1]) as { mcpServers: Record<string, object> };
    expect(cfg.mcpServers.a).toEqual({ command: "c" });
  });

  it("returns no flag when nothing is enabled (zero behaviour change)", () => {
    expect(mcpConfigArgs([])).toEqual([]);
    expect(mcpConfigArgs([srv({ enabled: false })])).toEqual([]);
  });
});
