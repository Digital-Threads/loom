import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { withTempHome, recordingRun, e2eDeps, writeFakePlugin } from "./helpers.js";
import { runPluginCli } from "../../src/cli/plugin-cli.js";
import { readInstalled } from "../../src/core/install/registry-file.js";
import { buildPack } from "../../src/core/pack/build-pack.js";
import type { PackInput } from "../../src/core/pack/pack-input.js";
import type { WorkspaceData } from "../../src/core/data/loader.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

// A deterministic WorkspaceData fixture (no timers/Date.now): all layers empty.
const emptyData: WorkspaceData = {
  subscriptions: [],
  sessions: [],
  health: [],
  tokens: [],
  tokenEvents: [],
  taskEvents: [],
  tasks: [],
  errors: [],
  projectId: "e2e-fixture",
};

describe("LP12 e2e: product from clean environment to workspace pack", () => {
  it("clean environment → catalog/CLI → install a plugin → visible in the registry → pack is non-empty", () => {
    // 1. Clean environment: temporary HOME/XDG, empty registry.
    const t = withTempHome();
    cleanups.push(t.cleanup);
    const { run, calls } = recordingRun({
      npm: { ok: true, stdout: "demo-1.0.0.tgz", stderr: "" },
      git: { ok: true, stdout: "", stderr: "" },
    });
    const deps = e2eDeps(t.root, run);

    // initial state — the registry is empty.
    expect(Object.keys(readInstalled(deps).plugins)).toHaveLength(0);
    const before = runPluginCli(["list"], deps);
    expect(before.code).toBe(0);
    expect(before.lines.join("\n")).toContain("no installed plugins");

    // 2. Catalog → install a plugin (local, no network). External commands are mocked.
    const pluginDir = writeFakePlugin(join(t.root, "demo-plugin"));
    const add = runPluginCli(["add", pluginDir, "--yes"], deps);
    expect(add.code).toBe(0);

    // 3. The plugin is visible in the registry (== "visible on the dashboard": same data source).
    const reg = readInstalled(deps);
    expect(Object.keys(reg.plugins)).toContain("demo");
    const after = runPluginCli(["list"], deps);
    expect(after.code).toBe(0);
    expect(after.lines.join("\n")).toContain("demo");

    // 4. No real side effects: everything that was called is from the allowlist
    //    of external commands. A local install may not invoke any external commands at all
    //    (calls is empty) — that is valid too.
    const allowed = ["npm", "git", "claude"];
    for (const c of calls) expect(allowed).toContain(c[0]);

    // 5. workspace pack returns a non-empty context for a new session.
    const packInput: PackInput = {
      data: emptyData,
      config: { projectName: "e2e-demo" },
    };
    const pack = buildPack(packInput);
    expect(pack.length).toBeGreaterThan(0);
    expect(pack).toContain("# Workspace pack");
    expect(pack).toContain("e2e-demo");
  });

  it.skipIf(process.env.LOOM_E2E_REAL !== "1")(
    "the real install path (behind the LOOM_E2E_REAL=1 guard, disabled in CI)",
    () => {
      // Real CmdRunner, real network — only locally by hand.
      // Stub: when LOOM_E2E_REAL=1 is set, the real pipeline is wired up here.
      // By default this case is skipped.
    },
  );
});
