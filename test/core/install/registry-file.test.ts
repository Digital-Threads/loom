import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readInstalled,
  setEnabled,
  writeInstalled,
} from "../../../src/core/install/registry-file.js";
import type { CmdRunner, InstallDeps, InstalledRegistry } from "../../../src/core/install/types.js";

const noopRun: CmdRunner = () => ({ ok: true, stdout: "", stderr: "" });

const tmpDirs: string[] = [];
function tmpDeps(): InstallDeps {
  const d = mkdtempSync(join(tmpdir(), "loom-reg-"));
  tmpDirs.push(d);
  return { dataDir: d, run: noopRun };
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seed(deps: InstallDeps, enabled: boolean): void {
  const reg: InstalledRegistry = {
    schemaVersion: 1,
    plugins: {
      foo: {
        version: "1.0.0",
        installPath: join(deps.dataDir, "plugins", "foo", "1.0.0"),
        enabled,
        source: "local ./foo",
      },
    },
  };
  writeInstalled(deps, reg);
}

describe("setEnabled", () => {
  it("disables an enabled plugin and writes the registry", () => {
    const deps = tmpDeps();
    seed(deps, true);
    const res = setEnabled(deps, "foo", false);
    expect(res.ok).toBe(true);
    expect(readInstalled(deps).plugins.foo.enabled).toBe(false);
  });

  it("enables a disabled plugin", () => {
    const deps = tmpDeps();
    seed(deps, false);
    const res = setEnabled(deps, "foo", true);
    expect(res.ok).toBe(true);
    expect(readInstalled(deps).plugins.foo.enabled).toBe(true);
  });

  it("no such name → {ok:false}, the registry is unchanged", () => {
    const deps = tmpDeps();
    seed(deps, true);
    const res = setEnabled(deps, "missing", false);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("missing");
    expect(readInstalled(deps).plugins.foo.enabled).toBe(true);
  });
});
