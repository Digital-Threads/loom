import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchToStaging,
  installPlugin,
  isFlagShaped,
  isValidGitUrl,
  isValidMarketplaceSource,
  isValidNpmSpec,
  planInstall,
  removePlugin,
} from "../../../src/core/install/install.js";
import { readInstalled } from "../../../src/core/install/registry-file.js";
import type { CmdRunner, InstallDeps, InstalledRegistry } from "../../../src/core/install/types.js";

// ── fake runner: records calls, does nothing ────────────────────────────────
function fakeRun(): { run: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CmdRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { ok: true, stdout: "", stderr: "" };
  };
  return { run, calls };
}

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A valid Loom plugin manifest + optional fields.
function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: "loom-plugin",
    name: "demo",
    title: "Demo",
    version: "1.0.0",
    apiVersion: "^1.0",
    entry: "./src/adapter.js",
    provides: { tabs: [{ id: "d", title: "Demo" }] },
    ...overrides,
  };
}

// Creates a local plugin directory with plugin.json and a fake adapter.
function makeLocalPlugin(manifest: Record<string, unknown>): string {
  const dir = tmp("loom-src-");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest), "utf8");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "adapter.js"), "export const plugin = {};", "utf8");
  return dir;
}

function makeDeps(): { deps: InstallDeps; calls: string[][] } {
  const { run, calls } = fakeRun();
  const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
  return { deps, calls };
}

describe("installPlugin — local", () => {
  it("happy path: copies files and writes the registry", () => {
    const src = makeLocalPlugin(baseManifest({ permissions: ["read:~/.x"] }));
    const { deps } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    expect(res.plan?.permissions).toEqual(["read:~/.x"]);

    const installed = join(deps.dataDir, "plugins", "demo", "1.0.0");
    expect(existsSync(join(installed, "plugin.json"))).toBe(true);
    expect(existsSync(join(installed, "src", "adapter.js"))).toBe(true);

    const reg = readInstalled(deps);
    expect(reg.plugins.demo.enabled).toBe(true);
    expect(reg.plugins.demo.version).toBe("1.0.0");
    expect(reg.plugins.demo.installPath).toBe(installed);
  });

  it("claudePlugin without install → synthesizes a shim recipe (marketplace add + install --scope)", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "./" } }),
    );
    const { deps, calls } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" });
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["claude", "plugin", "marketplace", "add", "--", "./"]);
    expect(calls).toContainEqual([
      "claude",
      "plugin",
      "install",
      "--scope",
      "user",
      "--",
      "x@x",
    ]);
  });

  it("manifest.install → finalize runs the install recipe with scope", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [
            { cmd: "claude", args: ["plugin", "install", "--scope", "{scope}", "x@x"], scoped: true },
          ],
          detect: { probe: { cmd: "claude", args: ["plugin", "list"] } },
          remove: [{ cmd: "claude", args: ["plugin", "uninstall", "x@x"] }],
        },
      }),
    );
    const { deps, calls } = makeDeps();
    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "project" });
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["claude", "plugin", "install", "--scope", "project", "x@x"]);
  });

  it("onConfirm=false → copies nothing and does not write the registry", () => {
    const src = makeLocalPlugin(baseManifest());
    const { deps } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps, () => false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("cancelled");

    expect(existsSync(join(deps.dataDir, "plugins", "demo"))).toBe(false);
    expect(existsSync(join(deps.dataDir, "plugins.json"))).toBe(false);
  });

  it("invalid manifest → ok:false with an error", () => {
    const src = makeLocalPlugin(baseManifest({ type: "cc-plugin" }));
    const { deps } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/type/);
  });

  it("no plugin.json in the source → ok:false", () => {
    const empty = tmp("loom-empty-");
    const { deps } = makeDeps();
    const res = installPlugin({ type: "local", path: empty }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/plugin\.json/);
  });

  it("manifest.install with an interactive step → the auto part installs, manual is returned, no crash", () => {
    const src = makeLocalPlugin(baseManifest({ install: {
      install: [{ cmd: "npm", args: ["install","-g","aimux"] },
                { cmd: "aimux", args: ["auth","login"], interactive: true }],
      detect: { probe: { cmd: "which", args: ["aimux"] } }, remove: [] } }));
    const { deps, calls } = makeDeps();
    const res = installPlugin({ type: "local", path: src }, deps, () => true, { scope: "user" });
    expect(res.ok).toBe(true);
    expect(calls).toContainEqual(["npm","install","-g","aimux"]);
    expect(calls.some((c) => c[0] === "aimux")).toBe(false);
    expect(res.manual).toEqual([["aimux","auth","login"]]);
  });
});

describe("planInstall", () => {
  it("passes through permissions from the manifest", () => {
    const src = makeLocalPlugin(baseManifest({ permissions: ["read:~/.x", "exec:y"] }));
    const { deps } = makeDeps();
    const res = planInstall({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    expect(res.plan?.permissions).toEqual(["read:~/.x", "exec:y"]);
    expect(res.plan?.installDir).toBe(join(deps.dataDir, "plugins", "demo", "1.0.0"));
  });
});

describe("removePlugin", () => {
  it("removes the installDir and the registry entry", () => {
    const src = makeLocalPlugin(baseManifest());
    const { deps } = makeDeps();
    installPlugin({ type: "local", path: src }, deps);

    const installed = join(deps.dataDir, "plugins", "demo", "1.0.0");
    expect(existsSync(installed)).toBe(true);

    const res = removePlugin("demo", deps);
    expect(res.ok).toBe(true);
    expect(existsSync(installed)).toBe(false);
    expect(readInstalled(deps).plugins.demo).toBeUndefined();
  });

  it("claudePlugin → calls claude plugin uninstall", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "./" } }),
    );
    const { deps, calls } = makeDeps();
    installPlugin({ type: "local", path: src }, deps);
    calls.length = 0;

    removePlugin("demo", deps);
    expect(calls).toContainEqual(["claude", "plugin", "uninstall", "--", "x@x"]);
  });

  it("manifest.install → removePlugin runs the remove recipe", () => {
    const src = makeLocalPlugin(
      baseManifest({
        install: {
          install: [],
          detect: { probe: { cmd: "claude", args: ["plugin", "list"] } },
          remove: [{ cmd: "claude", args: ["plugin", "uninstall", "x@x"] }],
        },
      }),
    );
    const { deps, calls } = makeDeps();
    installPlugin({ type: "local", path: src }, deps);
    removePlugin("demo", deps);
    expect(calls).toContainEqual(["claude", "plugin", "uninstall", "x@x"]);
  });

  it("not installed → ok:false", () => {
    const { deps } = makeDeps();
    expect(removePlugin("nope", deps).ok).toBe(false);
  });
});

describe("fetchToStaging — npm/git (covered only by a mocked run call)", () => {
  it("npm: calls npm pack + tar extract", () => {
    // npm pack prints the tgz name on stdout → the flow reaches tar (the fake tar does nothing).
    const calls: string[][] = [];
    const run: CmdRunner = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "npm") return { ok: true, stdout: "demo-1.0.0.tgz\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    };
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    fetchToStaging({ type: "npm", spec: "demo@1.0.0" }, deps);
    expect(calls[0][0]).toBe("npm");
    expect(calls[0].slice(0, 2)).toEqual(["npm", "pack"]);
    // "--" end-of-options sits right before the spec.
    expect(calls[0].slice(-2)).toEqual(["--", "demo@1.0.0"]);
    expect(calls.some((c) => c[0] === "tar")).toBe(true);
    // tar: flags/options, then "--", then the file (the tgz name as the last argument).
    const tarCall = calls.find((c) => c[0] === "tar")!;
    expect(tarCall[tarCall.length - 2]).toBe("--");
    expect(tarCall[tarCall.length - 1]).toMatch(/demo-1\.0\.0\.tgz$/);
  });

  it("git: calls git clone --depth 1", () => {
    const { run, calls } = fakeRun();
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    const res = fetchToStaging({ type: "git", url: "https://example/repo.git" }, deps);
    expect(res.ok).toBe(true);
    expect(calls[0].slice(0, 4)).toEqual(["git", "clone", "--depth", "1"]);
    expect(calls[0]).toContain("https://example/repo.git");
  });
});

// ── Argument-injection hardening ─────────────────────────────────────────────
describe("input validators (argument injection)", () => {
  it("isFlagShaped: flag-shaped and leading-space → true; normal → false", () => {
    expect(isFlagShaped("-x")).toBe(true);
    expect(isFlagShaped("--upload-pack=y")).toBe(true);
    expect(isFlagShaped("  --evil")).toBe(true);
    expect(isFlagShaped("https://github.com/o/r.git")).toBe(false);
    expect(isFlagShaped("owner/repo")).toBe(false);
  });

  it("isValidGitUrl", () => {
    expect(isValidGitUrl("https://github.com/o/r.git")).toBe(true);
    expect(isValidGitUrl("git@github.com:o/r.git")).toBe(true);
    expect(isValidGitUrl("github:o/r")).toBe(true);
    expect(isValidGitUrl("-x")).toBe(false);
    expect(isValidGitUrl("--upload-pack=evil")).toBe(false);
    expect(isValidGitUrl(" https://x")).toBe(false);
  });

  it("isValidNpmSpec", () => {
    expect(isValidNpmSpec("@scope/pkg@1.2.3")).toBe(true);
    expect(isValidNpmSpec("demo@1.0.0")).toBe(true);
    expect(isValidNpmSpec("pkg")).toBe(true);
    expect(isValidNpmSpec("-x")).toBe(false);
    expect(isValidNpmSpec("--registry=evil")).toBe(false);
    expect(isValidNpmSpec(" demo")).toBe(false);
  });

  it("isValidMarketplaceSource", () => {
    expect(isValidMarketplaceSource("owner/repo")).toBe(true);
    expect(isValidMarketplaceSource("https://github.com/o/r")).toBe(true);
    expect(isValidMarketplaceSource("./")).toBe(true);
    expect(isValidMarketplaceSource("-evil")).toBe(false);
    expect(isValidMarketplaceSource(" owner/repo")).toBe(false);
  });
});

describe("fetchToStaging — rejects malicious input without running a command", () => {
  it("git url flag-shaped → ok:false, run NOT called", () => {
    const { run, calls } = fakeRun();
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    const res = fetchToStaging({ type: "git", url: "--upload-pack=evil" }, deps);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("npm spec flag-shaped → ok:false, run NOT called", () => {
    const { run, calls } = fakeRun();
    const deps: InstallDeps = { dataDir: tmp("loom-data-"), run };
    const res = fetchToStaging({ type: "npm", spec: "-x" }, deps);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("claudePlugin recipe synthesis rejects a malicious source", () => {
  it("cp.source='-evil' → marketplace add NOT in calls, the Loom install part ran", () => {
    const src = makeLocalPlugin(
      baseManifest({ claudePlugin: { name: "x", marketplace: "x", source: "-evil" } }),
    );
    const { deps, calls } = makeDeps();

    const res = installPlugin({ type: "local", path: src }, deps);
    expect(res.ok).toBe(true);
    // marketplace add with a flag-shaped source must NOT reach the calls (filtered out in plan).
    expect(calls.some((c) => c[2] === "marketplace" && c[3] === "add")).toBe(false);
    // the install step is still synthesized and executed.
    expect(calls).toContainEqual(["claude", "plugin", "install", "--scope", "user", "--", "x@x"]);
  });
});

// Type sanity: the registry has the expected shape.
describe("registry-file", () => {
  it("readInstalled on an empty dataDir → empty registry", () => {
    const { deps } = makeDeps();
    const reg: InstalledRegistry = readInstalled(deps);
    expect(reg.schemaVersion).toBe(1);
    expect(reg.plugins).toEqual({});
  });
});
