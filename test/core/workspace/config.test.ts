import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../../../src/core/workspace/config.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("LP8 readWorkspaceConfig — defensive", () => {
  it("no file → default config (version 1, empty sections)", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    const cfg = readWorkspaceConfig(dir);
    expect(cfg.version).toBe(1);
    expect(cfg.workspace).toBeTypeOf("object");
    expect(cfg.plugins).toEqual({});
    expect(cfg.profiles).toEqual({});
  });
  it("broken YAML → default, does not throw", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    writeFileSync(join(dir, ".ai-workspace.yaml"), "::: not: valid: [yaml", "utf8");
    expect(() => readWorkspaceConfig(dir)).not.toThrow();
    expect(readWorkspaceConfig(dir).version).toBe(1);
  });
  it("valid file → parsed with plugin and profile fields", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    writeFileSync(
      join(dir, ".ai-workspace.yaml"),
      ["version: 1","workspace:","  name: demo","profiles:","  default:","    profile: work","plugins:","  token-pilot:","    enabled: true","  task-journal:","    enabled: false"].join("\n"),
      "utf8",
    );
    const cfg = readWorkspaceConfig(dir);
    expect(cfg.workspace.name).toBe("demo");
    expect(cfg.profiles.default?.profile).toBe("work");
    expect(cfg.plugins["token-pilot"]?.enabled).toBe(true);
    expect(cfg.plugins["task-journal"]?.enabled).toBe(false);
  });
});

describe("LP8 writeWorkspaceConfig — patch, preserves foreign keys", () => {
  it("creates the file if it does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    const ok = writeWorkspaceConfig(dir, { workspace: { name: "fresh" } });
    expect(ok).toBe(true);
    expect(readWorkspaceConfig(dir).workspace.name).toBe("fresh");
  });
  it("patches the plugins section without losing other plugins", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    writeWorkspaceConfig(dir, { plugins: { "token-pilot": { enabled: true }, "task-journal": { enabled: true } } });
    writeWorkspaceConfig(dir, { plugins: { "task-journal": { enabled: false } } });
    const cfg = readWorkspaceConfig(dir);
    expect(cfg.plugins["token-pilot"]?.enabled).toBe(true);
    expect(cfg.plugins["task-journal"]?.enabled).toBe(false);
  });
  it("preserves unfamiliar file keys (e.g. integration:)", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    writeFileSync(join(dir, ".ai-workspace.yaml"),
      ["version: 1","integration:","  event_bus: true","plugins:","  aimux:","    enabled: true"].join("\n"), "utf8");
    writeWorkspaceConfig(dir, { plugins: { aimux: { enabled: false } } });
    const onDisk = parse(readFileSync(join(dir, ".ai-workspace.yaml"), "utf8"));
    expect(onDisk.integration.event_bus).toBe(true);
    expect(onDisk.plugins.aimux.enabled).toBe(false);
  });
});
