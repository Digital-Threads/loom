import { describe, expect, it } from "vitest";
import { detectUpdate, compareVersions } from "../../../src/core/install/recipe.js";
import type { CmdRunner, InstallDeps } from "../../../src/core/install/types.js";
import type { DetectSpec } from "../../../src/core/plugins/contract.js";

function fake(results: Record<string, { ok: boolean; stdout?: string }> ) {
  const run: CmdRunner = (cmd, args) => {
    const k = [cmd, ...args].join(" ");
    return { ok: results[k]?.ok ?? true, stdout: results[k]?.stdout ?? "", stderr: "" };
  };
  return run;
}
const deps = (run: CmdRunner): InstallDeps => ({ dataDir: "/tmp/x", run });

describe("compareVersions", () => {
  it("semver-сравнение", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

const aimuxSpec: DetectSpec = {
  probe: { cmd: "npm", args: ["ls","-g","@digital-threads/aimux"] },
  versionRegex: "@digital-threads/aimux@([0-9.]+)",
  latest: { probe: { cmd: "npm", args: ["view","@digital-threads/aimux","version"] } },
};

describe("detectUpdate", () => {
  it("latest > installed → updateAvailable:true, обе версии", () => {
    const run = fake({
      "npm ls -g @digital-threads/aimux": { ok: true, stdout: "@digital-threads/aimux@1.2.0" },
      "npm view @digital-threads/aimux version": { ok: true, stdout: "1.4.0\n" },
    });
    const r = detectUpdate(aimuxSpec, deps(run));
    expect(r.installed).toBe(true);
    expect(r.version).toBe("1.2.0");
    expect(r.latest).toBe("1.4.0");
    expect(r.updateAvailable).toBe(true);
  });
  it("latest == installed → updateAvailable:false", () => {
    const run = fake({
      "npm ls -g @digital-threads/aimux": { ok: true, stdout: "@digital-threads/aimux@1.4.0" },
      "npm view @digital-threads/aimux version": { ok: true, stdout: "1.4.0" },
    });
    expect(detectUpdate(aimuxSpec, deps(run)).updateAvailable).toBe(false);
  });
  it("не установлен → updateAvailable:false, latest не запрашивается", () => {
    const run = fake({ "npm ls -g @digital-threads/aimux": { ok: false } });
    const r = detectUpdate(aimuxSpec, deps(run));
    expect(r.installed).toBe(false);
    expect(r.updateAvailable).toBe(false);
  });
  it("нет latest-spec или версия не парсится → updateAvailable:undefined (unknown)", () => {
    const run = fake({ "npm ls -g @digital-threads/aimux": { ok: true, stdout: "@digital-threads/aimux@1.2.0" } });
    const noLatest: DetectSpec = { probe: aimuxSpec.probe, versionRegex: aimuxSpec.versionRegex };
    expect(detectUpdate(noLatest, deps(run)).updateAvailable).toBeUndefined();
  });
});
