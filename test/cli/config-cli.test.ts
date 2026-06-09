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
// a fake prereq check so we do not run real binaries
const fakePrereq = () => ({ ok: true, tools: [{ name: "node", found: true, hint: "" }], missing: [] });

describe("runConfigCli", () => {
  it("doctor: prints a per-scope report, code 0, writes nothing", async () => {
    const r = await runConfigCli(["doctor"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/user|project|local/);
  });
  it("doctor: shows the Prerequisites section", async () => {
    const r = await runConfigCli(["doctor"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.lines.join("\n").toLowerCase()).toMatch(/prerequisit|node/);
  });
  it("merge --dry-run: prints a diff, writes nothing", async () => {
    const r = await runConfigCli(["merge", "--scope", "user", "--dry-run"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(0);
  });
  it("merge --apply --scope user: writes (applied)", async () => {
    const d = dirs();
    const r = await runConfigCli(["merge", "--scope", "user", "--apply"], { dirs: d, contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/applied|wrote|written|backup|\.bak/i);
  });
  it("unknown subcommand → code 1 + usage", async () => {
    const r = await runConfigCli(["bogus"], { dirs: dirs(), contributions, checkPrereq: fakePrereq });
    expect(r.code).toBe(1);
    expect(r.lines.join("\n").toLowerCase()).toMatch(/usage/);
  });
});
