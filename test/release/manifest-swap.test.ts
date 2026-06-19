import { describe, it, expect } from "vitest";
import { swapToVersions } from "../../scripts/prepare-publish.mjs";

const versions: Record<string, string> = {
  "@digital-threads/aimux": "0.13.0",
  "@digital-threads/loom-knowledge": "0.1.0",
  "@digital-threads/loom-swarm": "0.1.0",
  "@digital-threads/loom-quality": "0.1.0",
  "@digital-threads/loom-security": "0.1.0",
};
const resolve = (name: string) => {
  const v = versions[name];
  if (!v) throw new Error(`no version for ${name}`);
  return v;
};

const devManifest = {
  name: "@digital-threads/loom",
  dependencies: {
    "@digital-threads/aimux": "file:../aimux",
    "@digital-threads/loom-knowledge": "file:../knowledge",
    "@digital-threads/loom-swarm": "file:../swarm",
    "@digital-threads/loom-quality": "file:../quality",
    "@digital-threads/loom-security": "file:../security",
    "better-sqlite3": "^12.10.1",
    hono: "^4.12.25",
  },
};

describe("swapToVersions (D2.1 release manifest)", () => {
  it("pins every file:.. dep to its resolved version", () => {
    const out = swapToVersions(devManifest, resolve);
    expect(out.dependencies["@digital-threads/aimux"]).toBe("^0.13.0");
    expect(out.dependencies["@digital-threads/loom-knowledge"]).toBe("^0.1.0");
    expect(out.dependencies["@digital-threads/loom-swarm"]).toBe("^0.1.0");
    expect(out.dependencies["@digital-threads/loom-quality"]).toBe("^0.1.0");
    expect(out.dependencies["@digital-threads/loom-security"]).toBe("^0.1.0");
  });

  it("leaves non-file deps untouched", () => {
    const out = swapToVersions(devManifest, resolve);
    expect(out.dependencies["better-sqlite3"]).toBe("^12.10.1");
    expect(out.dependencies.hono).toBe("^4.12.25");
  });

  it("never leaves a file:.. in the result", () => {
    const out = swapToVersions(devManifest, resolve);
    for (const v of Object.values(out.dependencies)) {
      expect(typeof v === "string" && v.startsWith("file:")).toBe(false);
    }
  });

  it("handles a newly added sibling automatically (no allowlist to forget)", () => {
    const withNew = {
      dependencies: { ...devManifest.dependencies, "@digital-threads/loom-future": "file:../future" },
    };
    const resolvePlus = (name: string) =>
      name === "@digital-threads/loom-future" ? "1.0.0" : resolve(name);
    const out = swapToVersions(withNew, resolvePlus);
    expect(out.dependencies["@digital-threads/loom-future"]).toBe("^1.0.0");
  });

  it("throws if a file:.. dep survives the swap (broken manifest never ships)", () => {
    const badResolve = () => "file:../still-local"; // resolver misbehaves
    expect(() => swapToVersions(devManifest, badResolve)).toThrow(/local path/);
  });

  it("does not mutate the input manifest", () => {
    swapToVersions(devManifest, resolve);
    expect(devManifest.dependencies["@digital-threads/aimux"]).toBe("file:../aimux");
  });
});
