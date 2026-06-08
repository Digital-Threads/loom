import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMerge } from "../../../src/core/doctor/apply.js";

const contributions = [
  { plugin: "token-pilot", mcpServers: { "token-pilot": { command: "tp" } } },
  { plugin: "task-journal", mcpServers: { "task-journal": { command: "tj" } } },
];
let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });
function mk(): { homeDir: string; projectDir: string } {
  const homeDir = mkdtempSync(join(tmpdir(), "loom-ap-h-"));
  const projectDir = mkdtempSync(join(tmpdir(), "loom-ap-p-"));
  dirs.push(homeDir, projectDir);
  return { homeDir, projectDir };
}

describe("runMerge", () => {
  it("dry-run: не пишет target, возвращает diff", () => {
    const d = mk();
    const userSettings = join(d.homeDir, ".claude", "settings.json");
    mkdirSync(join(d.homeDir, ".claude"), { recursive: true });
    writeFileSync(userSettings, JSON.stringify({ foreignKey: 1 }), "utf8");
    const before = readFileSync(userSettings, "utf8");
    const r = runMerge({ scope: "user", contributions, dirs: d, apply: false });
    expect(r.applied).toBe(false);
    expect(r.backupPath).toBeNull();
    expect(readFileSync(userSettings, "utf8")).toBe(before);
    expect(r.diff.addedMcp.length).toBeGreaterThan(0);
  });
  it("apply: пишет scope-файл, делает backup, сохраняет foreign keys", () => {
    const d = mk();
    const userSettings = join(d.homeDir, ".claude", "settings.json");
    mkdirSync(join(d.homeDir, ".claude"), { recursive: true });
    writeFileSync(userSettings, JSON.stringify({ foreignKey: 1 }), "utf8");
    const r = runMerge({ scope: "user", contributions, dirs: d, apply: true });
    expect(r.applied).toBe(true);
    expect(existsSync(r.backupPath as string)).toBe(true);
    const written = JSON.parse(readFileSync(userSettings, "utf8"));
    expect(written.foreignKey).toBe(1);
    expect(written.mcpServers["token-pilot"]).toBeDefined();
  });
  it("apply: создаёт <proj>/.claude если нет (project scope)", () => {
    const d = mk();
    const r = runMerge({ scope: "project", contributions, dirs: d, apply: true });
    expect(r.applied).toBe(true);
    expect(existsSync(join(d.projectDir, ".claude", "settings.json"))).toBe(true);
  });
});
