import { expect, it } from "vitest";
import { INSTALL_UNITS, runInstallPlan, type InstallEvent } from "../../../src/core/install/bootstrap.js";
import type { CmdRunner } from "../../../src/core/install/types.js";

// Fake runner: `tools` = system tools already on PATH (which probe), `plugins` =
// plugin ids already present (claude plugin list). Every other (install) command
// succeeds and is recorded. `failNpm` fails the claude CLI install.
function fake(opts: { tools?: string[]; plugins?: string[]; failNpm?: boolean } = {}) {
  const tools = new Set(opts.tools ?? []);
  const plugins = opts.plugins ?? [];
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    if (cmd === "which" || cmd === "where") return { ok: tools.has(args[0]), stdout: "", stderr: "" };
    if (args.includes("list")) return { ok: true, stdout: plugins.join("\n"), stderr: "" };
    if (opts.failNpm && cmd === "npm" && args[0] === "install") return { ok: false, stdout: "", stderr: "npm: EACCES" };
    calls.push([cmd, ...args]);
    return { ok: true, stdout: "", stderr: "" };
  };
  return { run, calls };
}

// task-journal installs prebuilt binaries via deps.fetchRelease (loom-hwfu);
// `fetchOk:false` simulates an unsupported platform / download failure.
const deps = (run: CmdRunner, fetchOk = true) => ({
  dataDir: "/tmp", run,
  fetchRelease: () => (fetchOk ? { ok: true } : { ok: false, error: "no prebuilt binary" }),
});

async function plan(run: CmdRunner, fetchOk = true) {
  const events: InstallEvent[] = [];
  const summary = await runInstallPlan(INSTALL_UNITS, deps(run, fetchOk), (e) => { events.push(e); });
  return { events, summary };
}

it("nothing present -> installs all units in order (no Rust toolchain)", async () => {
  const { run } = fake();
  const { summary } = await plan(run);
  expect(summary.installed).toEqual(["claude", "token-pilot", "task-journal", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  expect(summary.failed).toEqual([]);
});

it("already present: system tools skip; plugins refresh to latest (claude plugin update)", async () => {
  const { run, calls } = fake({
    tools: ["claude"],
    plugins: ["token-pilot@token-pilot", "task-journal@task-journal", "caveman@caveman", "qa-skills@neonwatty-qa", "canary@canary-marketplace", "context-mode@context-mode", "superpowers@claude-plugins-official"],
  });
  const { summary } = await plan(run);
  expect(summary.skipped).toEqual(["claude"]); // toolchain not version-forced
  expect(summary.installed).toEqual(["token-pilot", "task-journal", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  expect(summary.failed).toEqual([]);
  // every present plugin was refreshed via `claude plugin update <ref>`
  expect(calls.filter((c) => c[0] === "claude" && c[2] === "update").length).toBe(7);
});

it("task-journal's prebuilt-binary download fails -> task-journal fails, other plugins still install", async () => {
  const { run } = fake();
  const { summary } = await plan(run, /* fetchOk */ false);
  expect(summary.failed).toEqual(["task-journal"]);
  expect(summary.installed).toEqual(["claude", "token-pilot", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
});

it("emits a final done event with the summary", async () => {
  const { run } = fake();
  const { events } = await plan(run);
  const done = events.at(-1);
  expect(done?.kind).toBe("done");
});

it("claude install fails -> token-pilot & task-journal skipped (needs claude), not hard-failed", async () => {
  const { run } = fake({ failNpm: true });
  const { events, summary } = await plan(run);
  expect(summary.failed).toEqual(["claude"]);
  expect(summary.skipped).toEqual(["token-pilot", "task-journal", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  const tp = events.find((e) => e.kind === "step" && e.id === "token-pilot" && e.state === "skipped");
  expect(tp && "message" in tp ? tp.message : "").toContain("needs claude");
});
