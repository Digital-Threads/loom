import { describe, it, expect } from "vitest";
import { runPackCli } from "../../src/cli/pack-cli.js";

const data = { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [],
  taskEvents: [], tasks: [], projectId: "", errors: [] } as any;
const baseDeps = { loadData: async () => data, readConfig: () => ({ projectName: "t" }) };

describe("runPackCli", () => {
  it("stdout by default: code 0, markdown in lines", async () => {
    const r = await runPackCli([], baseDeps);
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toContain("# Workspace pack");
  });
  it("--out writes to a file (writeFile injection)", async () => {
    let written = "";
    const r = await runPackCli(["--out", "/tmp/p.md"], { ...baseDeps, writeFile: (_p, c) => { written = c; } });
    expect(r.code).toBe(0);
    expect(r.lines[0]).toMatch(/pack written: \/tmp\/p\.md/);
    expect(written).toContain("# Workspace pack");
  });
  it("--out without a path → code 1", async () => {
    const r = await runPackCli(["--out"], baseDeps);
    expect(r.code).toBe(1);
  });
  it("--copy on clipboard failure → code 0 + falls back to stdout", async () => {
    const r = await runPackCli(["--copy"], { ...baseDeps, copyToClipboard: () => { throw new Error("no clip"); } });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/clipboard unavailable/);
    expect(r.lines.join("\n")).toContain("# Workspace pack");
  });
  it("unknown flag → code 1 + usage", async () => {
    const r = await runPackCli(["--bogus"], baseDeps);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toMatch(/usage/);
  });
});
