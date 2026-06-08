import { describe, it, expect } from "vitest";
import { diagnoseScope } from "../../../src/core/doctor/doctor.js";

const contributions = [
  { plugin: "token-pilot", mcpServers: { "token-pilot": { command: "tp" } },
    hooks: { PreToolUse: [{ matcher: "", hooks: [{ command: "tp-pre" }] }] } },
  { plugin: "task-journal", mcpServers: { "task-journal": { command: "tj" } } },
];

describe("diagnoseScope", () => {
  it("reports missing entries when current is empty", () => {
    const rep = diagnoseScope("user", contributions, {});
    expect(rep.missingMcp).toEqual(expect.arrayContaining(["token-pilot", "task-journal"]));
    expect(rep.missingHookEvents).toContain("PreToolUse");
    expect(rep.ok).toBe(false);
  });
  it("ok=true when current already contains expected", () => {
    const current = {
      mcpServers: { "token-pilot": { command: "tp" }, "task-journal": { command: "tj" } },
      hooks: { PreToolUse: [{ matcher: "", hooks: [{ command: "tp-pre" }] }] },
    };
    const rep = diagnoseScope("user", contributions, current);
    expect(rep.missingMcp).toEqual([]);
    expect(rep.missingHookEvents).toEqual([]);
    expect(rep.ok).toBe(true);
  });
  it("flags MCP value mismatch (plugin wants X, disk has Y)", () => {
    const current = { mcpServers: { "token-pilot": { command: "OLD" }, "task-journal": { command: "tj" } },
      hooks: { PreToolUse: [{ matcher: "", hooks: [{ command: "tp-pre" }] }] } };
    const rep = diagnoseScope("user", contributions, current);
    expect(rep.changedMcp).toContain("token-pilot");
    expect(rep.ok).toBe(false);
  });
  it("flags hook-collision: >1 plugin contributes to same event", () => {
    const collide = [
      { plugin: "a", hooks: { PreToolUse: [{ matcher: "", hooks: [{ command: "a" }] }] } },
      { plugin: "b", hooks: { PreToolUse: [{ matcher: "", hooks: [{ command: "b" }] }] } },
    ];
    const rep = diagnoseScope("user", collide, {});
    expect(rep.hookCollisions).toContainEqual(expect.objectContaining({ event: "PreToolUse", plugins: ["a", "b"] }));
  });
});
