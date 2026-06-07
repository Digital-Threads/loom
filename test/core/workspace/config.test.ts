import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceConfig } from "../../../src/core/workspace/config.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("LP8 readWorkspaceConfig — defensive", () => {
  it("нет файла → дефолтный конфиг (version 1, пустые секции)", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    const cfg = readWorkspaceConfig(dir);
    expect(cfg.version).toBe(1);
    expect(cfg.workspace).toBeTypeOf("object");
    expect(cfg.plugins).toEqual({});
    expect(cfg.profiles).toEqual({});
  });
  it("битый YAML → дефолт, не бросает", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-ws-"));
    writeFileSync(join(dir, ".ai-workspace.yaml"), "::: not: valid: [yaml", "utf8");
    expect(() => readWorkspaceConfig(dir)).not.toThrow();
    expect(readWorkspaceConfig(dir).version).toBe(1);
  });
  it("валидный файл → читается с полями плагинов и профиля", () => {
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
