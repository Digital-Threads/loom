import { describe, it, expect } from "vitest";
import { collectExpected } from "../../../src/core/doctor/collect.js";

describe("collectExpected", () => {
  it("union MCP, dedup hooks; flags MCP collision (same name, diff value)", () => {
    const r = collectExpected([
      { plugin: "a", mcpServers: { srv: { command: "x" } }, hooks: { PreToolUse: [{ matcher: "", hooks: [{ command: "h" }] }] } },
      { plugin: "b", mcpServers: { srv: { command: "y" } } },
    ]);
    expect(Object.keys(r.expected.mcpServers as object)).toContain("srv");
    expect(r.mcpCollisions).toContainEqual(expect.objectContaining({ server: "srv", plugins: ["a", "b"] }));
    expect((r.expected.hooks as any).PreToolUse[0].hooks).toHaveLength(1);
  });
  it("no collision when MCP value identical", () => {
    const r = collectExpected([
      { plugin: "a", mcpServers: { srv: { command: "x" } } },
      { plugin: "b", mcpServers: { srv: { command: "x" } } },
    ]);
    expect(r.mcpCollisions).toEqual([]);
  });
});
