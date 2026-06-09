import { describe, it, expect } from "vitest";
import {
  validateManifest,
  LOOM_CONTRACT_VERSION,
  type LoomPluginManifest,
} from "../../../src/core/plugins/manifest.js";

const valid: LoomPluginManifest = {
  schemaVersion: 1,
  type: "loom-plugin",
  name: "token-pilot",
  title: "Token Pilot",
  version: "0.1.0",
  apiVersion: "^1.0",
  entry: "./dist/adapter.js",
  provides: { tabs: [{ id: "tp", title: "Token Pilot" }] },
};

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.name).toBe("token-pilot");
  });

  it("ignores extra/unknown fields (forward-compat)", () => {
    const r = validateManifest({ ...valid, futureField: 42, extra: { a: 1 } });
    expect(r.ok).toBe(true);
  });

  it("not an object → ok:false", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest("x").ok).toBe(false);
    expect(validateManifest([valid]).ok).toBe(false);
  });

  it("missing type → ok:false", () => {
    const { type, ...rest } = valid;
    const r = validateManifest(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type/);
  });

  it("wrong type → ok:false", () => {
    const r = validateManifest({ ...valid, type: "cc-plugin" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/type/);
  });

  it("schemaVersion != 1 → ok:false", () => {
    const r = validateManifest({ ...valid, schemaVersion: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schemaVersion/);
  });

  it("no name → ok:false", () => {
    const { name, ...rest } = valid;
    const r = validateManifest(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/name/);
  });

  it("empty name → ok:false", () => {
    const r = validateManifest({ ...valid, name: "" });
    expect(r.ok).toBe(false);
  });

  it("no title → ok:false", () => {
    const { title, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("no version → ok:false", () => {
    const { version, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("no apiVersion → ok:false", () => {
    const { apiVersion, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("no entry → ok:false", () => {
    const { entry, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("provides.tabs not an array → ok:false", () => {
    const r = validateManifest({ ...valid, provides: { tabs: "nope" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tabs/);
  });

  it("provides missing → ok:false", () => {
    const { provides, ...rest } = valid;
    expect(validateManifest(rest).ok).toBe(false);
  });

  it("tab without id/title → ok:false", () => {
    const r = validateManifest({
      ...valid,
      provides: { tabs: [{ id: "x" }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tabs/);
  });

  it("exports LOOM_CONTRACT_VERSION", () => {
    expect(LOOM_CONTRACT_VERSION).toBe("1.0");
  });

  it("a valid install recipe passes", () => {
    const m = {
      ...valid,
      install: {
        install: [{ cmd: "npm", args: ["i", "-g", "x"] }],
        detect: { probe: { cmd: "which", args: ["x"] } },
        remove: [{ cmd: "npm", args: ["rm", "-g", "x"] }],
      },
    };
    expect(validateManifest(m).ok).toBe(true);
  });

  it("install without detect.probe → error", () => {
    const m = { ...valid, install: { install: [], detect: {}, remove: [] } };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/detect\.probe/);
  });

  it("step without cmd → error", () => {
    const m = {
      ...valid,
      install: {
        install: [{ args: [] }],
        detect: { probe: { cmd: "x", args: [] } },
        remove: [],
      },
    };
    expect(validateManifest(m).ok).toBe(false);
  });

  it("absence of install (legacy claudePlugin) → ok", () => {
    expect(validateManifest(valid).ok).toBe(true);
  });
});
