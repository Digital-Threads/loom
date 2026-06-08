import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigCli } from "../../src/cli/config-cli.js";

const contributions = [
  { plugin: "token-pilot", mcpServers: { "token-pilot": { command: "tp" } } },
  { plugin: "task-journal", mcpServers: { "task-journal": { command: "tj" } } },
];
let tmps: string[] = [];
afterEach(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }); tmps = []; });
function dirs() {
  const homeDir = mkdtempSync(join(tmpdir(), "loom-cc-h-"));
  const projectDir = mkdtempSync(join(tmpdir(), "loom-cc-p-"));
  tmps.push(homeDir, projectDir);
  return { homeDir, projectDir };
}
// фейковый prereq-чек, чтобы не запускать реальные бинарники
const fakePrereq = () => ({ ok: true, tools: [{ name: "node", found: true, hint: "" }], missing: [] });

describe("runConfigCli", () => {
  it("doctor: печатает отчёт по scope, code 0, ничего не пишет", async () => {
    const r = await runConfigCli(["doctor"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/user|project|local/);
  });
  it("doctor: показывает секцию Prerequisites", async () => {
    const r = await runConfigCli(["doctor"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.lines.join("\n").toLowerCase()).toMatch(/prerequisit|node/);
  });
  it("merge --dry-run: печатает diff, не пишет", async () => {
    const r = await runConfigCli(["merge", "--scope", "user", "--dry-run"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(0);
  });
  it("merge --apply --scope user: пишет (applied)", async () => {
    const d = dirs();
    const r = await runConfigCli(["merge", "--scope", "user", "--apply"], { dirs: d, contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/примен|applied|записан|backup|\.bak/i);
  });
  it("неизвестная подкоманда → code 1 + usage", async () => {
    const r = await runConfigCli(["bogus"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(1);
    expect(r.lines.join("\n").toLowerCase()).toMatch(/usage/);
  });
});
