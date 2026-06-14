import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServeArgs } from "../../src/cli/serve-args.js";
import { runPluginNew } from "../../src/cli/plugin-new.js";

describe("parseServeArgs (D2.1)", () => {
  it("defaults: default port, open=true, no project", () => {
    expect(parseServeArgs([], 4317)).toEqual({ port: 4317, open: true, project: undefined });
  });
  it("parses --port, --no-open, --project", () => {
    expect(parseServeArgs(["--port", "5000", "--no-open", "--project", "/repo"], 4317)).toEqual({
      port: 5000, open: false, project: "/repo",
    });
  });
  it("bad port falls back to default", () => {
    expect(parseServeArgs(["--port", "abc"], 4317).port).toBe(4317);
  });
});

describe("runPluginNew (D2 / L11.4)", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "loom-new-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the scaffold files to disk", () => {
    const written = runPluginNew("my-plugin", dir);
    expect(written).toContain("my-plugin/plugin.json");
    expect(existsSync(join(dir, "my-plugin/plugin.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "my-plugin/plugin.json"), "utf8"))).toMatchObject({ name: "my-plugin" });
    expect(readFileSync(join(dir, "my-plugin/src/adapter.ts"), "utf8")).toContain("LoomPlugin");
  });
});
