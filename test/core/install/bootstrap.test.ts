import { expect, it } from "vitest";
import { INSTALL_UNITS, runInstallPlan, type InstallEvent } from "../../../src/core/install/bootstrap.js";
import type { CmdRunner } from "../../../src/core/install/types.js";

// Fake runner: `tools` = system tools already on PATH (which probe), `plugins` =
// plugin ids already present (claude plugin list). `failSh` makes the rustup
// shell step fail. Every other (install) command succeeds and is recorded.
function fake(opts: { tools?: string[]; plugins?: string[]; failSh?: boolean; failNpm?: boolean; failCargoInstall?: boolean } = {}) {
  const tools = new Set(opts.tools ?? []);
  const plugins = opts.plugins ?? [];
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    if (cmd === "which" || cmd === "where") return { ok: tools.has(args[0]), stdout: "", stderr: "" };
    if (args.includes("list")) return { ok: true, stdout: plugins.join("\n"), stderr: "" };
    if (opts.failSh && cmd === "sh") return { ok: false, stdout: "", stderr: "rustup: no network" };
    if (opts.failNpm && cmd === "npm" && args[0] === "install") return { ok: false, stdout: "", stderr: "npm: EACCES" };
    if (opts.failCargoInstall && cmd === "cargo" && args[0] === "install") return { ok: false, stdout: "", stderr: "crate not found" };
    calls.push([cmd, ...args]);
    return { ok: true, stdout: "", stderr: "" };
  };
  return { run, calls };
}

const deps = (run: CmdRunner) => ({ dataDir: "/tmp", run });

async function plan(run: CmdRunner) {
  const events: InstallEvent[] = [];
  const summary = await runInstallPlan(INSTALL_UNITS, deps(run), (e) => { events.push(e); });
  return { events, summary };
}

it("nothing present -> installs all units in order", async () => {
  const { run } = fake();
  const { summary } = await plan(run);
  expect(summary.installed).toEqual(["cargo", "claude", "token-pilot", "task-journal", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  expect(summary.failed).toEqual([]);
});

it("already present: system tools skip; plugins refresh to latest (claude plugin update)", async () => {
  const { run, calls } = fake({
    tools: ["cargo", "claude"],
    plugins: ["token-pilot@token-pilot", "task-journal@task-journal", "caveman@caveman", "qa-skills@neonwatty-qa", "canary@canary-marketplace", "context-mode@context-mode", "superpowers@claude-plugins-official"],
  });
  const { summary } = await plan(run);
  expect(summary.skipped).toEqual(["cargo", "claude"]); // toolchain not version-forced
  expect(summary.installed).toEqual(["token-pilot", "task-journal", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  expect(summary.failed).toEqual([]);
  // every present plugin was refreshed via `claude plugin update <ref>`
  expect(calls.filter((c) => c[0] === "claude" && c[2] === "update").length).toBe(7);
});

it("rustup step fails -> cargo failed, task-journal skipped (needs cargo), claude & token-pilot still install", async () => {
  const { run } = fake({ failSh: true });
  const { events, summary } = await plan(run);
  expect(summary.failed).toEqual(["cargo"]);
  expect(summary.installed).toEqual(["claude", "token-pilot", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  expect(summary.skipped).toEqual(["task-journal"]);
  const tj = events.find((e) => e.kind === "step" && e.id === "task-journal" && e.state === "skipped");
  expect(tj && "message" in tj ? tj.message : "").toContain("needs cargo");
});

it("emits a final done event with the summary", async () => {
  const { run } = fake();
  const { events } = await plan(run);
  const done = events.at(-1);
  expect(done?.kind).toBe("done");
});

it("the rustup step is a shell pipe (sh -c curl … | sh -s -- -y)", () => {
  const cargo = INSTALL_UNITS.find((u) => u.id === "cargo")!;
  expect(cargo.steps[0].cmd).toBe("sh");
  expect(cargo.steps[0].args[0]).toBe("-c");
  expect(cargo.steps[0].args[1]).toContain("sh.rustup.rs");
});

it("claude install fails -> token-pilot & task-journal skipped (needs claude), not hard-failed", async () => {
  const { run } = fake({ failNpm: true });
  const { events, summary } = await plan(run);
  expect(summary.failed).toEqual(["claude"]);
  expect(summary.skipped).toEqual(["token-pilot", "task-journal", "caveman", "qa-skills", "canary", "context-mode", "superpowers"]);
  const tp = events.find((e) => e.kind === "step" && e.id === "token-pilot" && e.state === "skipped");
  expect(tp && "message" in tp ? tp.message : "").toContain("needs claude");
});

it("partial success (optional cargo step fails) -> done event carries the warning", async () => {
  // cargo & claude already present, plugins absent -> task-journal installs, but
  // its optional `cargo install` fails -> ok:true with a warning surfaced in done.
  const { run } = fake({ tools: ["cargo", "claude"], failCargoInstall: true });
  const { events, summary } = await plan(run);
  expect(summary.installed).toContain("task-journal");
  const done = events.find((e) => e.kind === "step" && e.id === "task-journal" && e.state === "done");
  expect(done && "message" in done ? done.message : "").toContain("crate not found");
});
