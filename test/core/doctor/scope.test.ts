import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { settingsPathForScope, SCOPES } from "../../../src/core/doctor/scope.js";

describe("settingsPathForScope", () => {
  it("user → <home>/.claude/settings.json", () => {
    expect(settingsPathForScope("user", { homeDir: "/h", projectDir: "/p" })).toBe(join("/h", ".claude", "settings.json"));
  });
  it("project → <proj>/.claude/settings.json", () => {
    expect(settingsPathForScope("project", { homeDir: "/h", projectDir: "/p" })).toBe(join("/p", ".claude", "settings.json"));
  });
  it("local → <proj>/.claude/settings.local.json", () => {
    expect(settingsPathForScope("local", { homeDir: "/h", projectDir: "/p" })).toBe(join("/p", ".claude", "settings.local.json"));
  });
  it("local vs project: одна .claude-директория, разные файлы", () => {
    const dirs = { homeDir: "/h", projectDir: "/p" };
    const proj = settingsPathForScope("project", dirs);
    const local = settingsPathForScope("local", dirs);
    expect(proj).not.toBe(local);
    expect(dirname(proj)).toBe(dirname(local));
    expect(proj.endsWith("settings.json")).toBe(true);
    expect(local.endsWith("settings.local.json")).toBe(true);
  });
  it("SCOPES = user, project, local", () => {
    expect(SCOPES).toEqual(["user", "project", "local"]);
  });
});
