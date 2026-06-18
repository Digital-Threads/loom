import { describe, it, expect } from "vitest";
import { ENFORCED_MCP, enforcedMcpPath } from "../../../src/core/automation/enforced-mcp.js";
import { readFileSync } from "node:fs";

describe("enforced mcp", () => {
  it("guarantees the task-journal MCP server for every session", () => {
    expect(ENFORCED_MCP.mcpServers["task-journal"]).toEqual({ command: "task-journal-mcp" });
  });

  it("writes the mcp-config file and returns its path", () => {
    const p = enforcedMcpPath();
    expect(p).toMatch(/enforced-mcp\.json$/);
    const written = JSON.parse(readFileSync(p, "utf8"));
    expect(written.mcpServers["task-journal"].command).toBe("task-journal-mcp");
  });
});
