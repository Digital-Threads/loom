import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMcp, addMcp, toggleMcp, removeMcp, testMcp } from "../../../src/core/connectors/mcp.js";

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
