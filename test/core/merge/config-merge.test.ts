import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeHooks,
  mergeMcpServers,
  pickStatusline,
  diffSettings,
  mergeConfigs,
  type HooksConfig,
} from "../../../src/core/merge/config-merge.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("mergeHooks", () => {
  it("union + dedup: same matcher + same command collapses to one hook", () => {
    const a: HooksConfig = {
      PostToolUse: [{ matcher: "Bash", hooks: [{ command: "X" }] }],
    };
    const b: HooksConfig = {
      PostToolUse: [{ matcher: "Bash", hooks: [{ command: "X" }] }],
    };
    const out = mergeHooks([a, b]);
    expect(out.PostToolUse).toHaveLength(1);
    expect(out.PostToolUse[0].matcher).toBe("Bash");
    expect(out.PostToolUse[0].hooks).toHaveLength(1);
  });

  it("union: same matcher, different commands → one entry with two hooks", () => {
    const a: HooksConfig = {
      PostToolUse: [{ matcher: "Bash", hooks: [{ command: "X" }] }],
    };
    const b: HooksConfig = {
      PostToolUse: [{ matcher: "Bash", hooks: [{ command: "Y" }] }],
    };
    const out = mergeHooks([a, b]);
    expect(out.PostToolUse).toHaveLength(1);
    expect(out.PostToolUse[0].hooks).toHaveLength(2);
    expect(out.PostToolUse[0].hooks.map((h) => h.command)).toEqual(["X", "Y"]);
  });

  it("union: different matchers → two entries", () => {
    const a: HooksConfig = {
      PostToolUse: [{ matcher: "Bash", hooks: [{ command: "X" }] }],
    };
    const b: HooksConfig = {
      PostToolUse: [{ matcher: "Read", hooks: [{ command: "Y" }] }],
    };
    const out = mergeHooks([a, b]);
    expect(out.PostToolUse).toHaveLength(2);
    expect(out.PostToolUse.map((e) => e.matcher)).toEqual(["Bash", "Read"]);
  });
});

describe("mergeMcpServers", () => {
  it("union of distinct names, no collisions", () => {
    const r = mergeMcpServers([{ a: {} }, { b: {} }]);
    expect(r.merged).toHaveProperty("a");
    expect(r.merged).toHaveProperty("b");
    expect(r.collisions).toEqual([]);
  });

  it("collision with different value → last-wins + reported", () => {
    const r = mergeMcpServers([
      { a: { command: "old" } },
      { a: { command: "new" } },
    ]);
    expect(r.merged.a).toEqual({ command: "new" });
    expect(r.collisions).toEqual(["a"]);
  });

  it("same value in both sources is not a collision", () => {
    const r = mergeMcpServers([
      { a: { command: "same" } },
      { a: { command: "same" } },
    ]);
    expect(r.merged.a).toEqual({ command: "same" });
    expect(r.collisions).toEqual([]);
  });
});

describe("pickStatusline", () => {
  it("returns first non-undefined/non-null candidate", () => {
    expect(pickStatusline([undefined, null, { x: 1 }, { y: 2 }])).toEqual({ x: 1 });
  });

  it("returns undefined when nothing usable", () => {
    expect(pickStatusline([undefined])).toBeUndefined();
  });
});

describe("diffSettings", () => {
  it("detects added mcp server", () => {
    const d = diffSettings(
      { mcpServers: { a: {} } },
      { mcpServers: { a: {}, b: {} } },
    );
    expect(d.addedMcp).toEqual(["b"]);
    expect(d.text).toContain("b");
  });

  it("detects statusline change", () => {
    const d = diffSettings(
      { statusLine: { type: "x" } },
      { statusLine: { type: "y" } },
    );
    expect(d.statuslineChanged).toBe(true);
  });
});

describe("mergeConfigs (file orchestrator)", () => {
  it("dry-run does not modify target file", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-merge-"));
    const target = join(dir, "settings.json");
    const source = join(dir, "src.json");
    const targetContent = JSON.stringify({
      hooks: { PostToolUse: [{ matcher: "", hooks: [{ command: "keep" }] }] },
      customKey: 1,
    });
    writeFileSync(target, targetContent, "utf8");
    writeFileSync(source, JSON.stringify({ mcpServers: { srv: { command: "c" } } }), "utf8");

    const r = mergeConfigs(target, [source], { apply: false });
    expect(r.applied).toBe(false);
    expect(r.backupPath).toBeNull();
    expect(r.diff.addedMcp).toContain("srv");
    // file untouched on disk
    expect(readFileSync(target, "utf8")).toBe(targetContent);
  });

  it("apply: backs up original and preserves foreign keys + existing hooks", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-merge-"));
    const target = join(dir, "settings.json");
    const source = join(dir, "src.json");
    const targetContent = JSON.stringify({
      hooks: { PostToolUse: [{ matcher: "", hooks: [{ command: "keep" }] }] },
      customKey: 1,
    });
    writeFileSync(target, targetContent, "utf8");
    writeFileSync(source, JSON.stringify({ mcpServers: { srv: { command: "c" } } }), "utf8");

    const r = mergeConfigs(target, [source], { apply: true });
    expect(r.applied).toBe(true);
    expect(r.backupPath).not.toBeNull();
    expect(existsSync(r.backupPath as string)).toBe(true);
    expect(readFileSync(r.backupPath as string, "utf8")).toBe(targetContent);

    const written = JSON.parse(readFileSync(target, "utf8"));
    expect(written.mcpServers.srv).toEqual({ command: "c" });
    expect(written.customKey).toBe(1);
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe("keep");
  });

  it("missing target: does not throw, no backup, writes source data", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-merge-"));
    const target = join(dir, "nonexistent.json");
    const source = join(dir, "src.json");
    writeFileSync(source, JSON.stringify({ mcpServers: { srv: { command: "c" } } }), "utf8");

    const r = mergeConfigs(target, [source], { apply: true });
    expect(r.applied).toBe(true);
    expect(r.backupPath).toBeNull();
    const written = JSON.parse(readFileSync(target, "utf8"));
    expect(written.mcpServers.srv).toEqual({ command: "c" });
  });
});
