import { describe, it, expect } from "vitest";
import { runPackCli } from "../../src/cli/pack-cli.js";

const data = { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [],
  taskEvents: [], tasks: [], projectId: "", errors: [] } as any;
const baseDeps = { loadData: async () => data, readConfig: () => ({ projectName: "t" }) };

describe("runPackCli", () => {
  it("stdout по умолчанию: code 0, markdown в lines", async () => {
    const r = await runPackCli([], baseDeps);
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toContain("# Workspace pack");
  });
  it("--out пишет в файл (инъекция writeFile)", async () => {
    let written = "";
    const r = await runPackCli(["--out", "/tmp/p.md"], { ...baseDeps, writeFile: (_p, c) => { written = c; } });
    expect(r.code).toBe(0);
    expect(r.lines[0]).toMatch(/pack записан: \/tmp\/p\.md/);
    expect(written).toContain("# Workspace pack");
  });
  it("--out без пути → code 1", async () => {
    const r = await runPackCli(["--out"], baseDeps);
    expect(r.code).toBe(1);
  });
  it("--copy при сбое буфера → code 0 + деградация на stdout", async () => {
    const r = await runPackCli(["--copy"], { ...baseDeps, copyToClipboard: () => { throw new Error("no clip"); } });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toMatch(/буфер недоступен/);
    expect(r.lines.join("\n")).toContain("# Workspace pack");
  });
  it("неизвестный флаг → code 1 + usage", async () => {
    const r = await runPackCli(["--bogus"], baseDeps);
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toMatch(/usage/);
  });
});
