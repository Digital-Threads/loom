import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApiCompatible, loadPlugins } from "../../../src/core/plugins/load.js";
import type { DiscoveredManifest } from "../../../src/core/plugins/discover.js";
import type { LoomPluginManifest } from "../../../src/core/plugins/manifest.js";

function manifest(overrides: Partial<LoomPluginManifest>): LoomPluginManifest {
  return {
    schemaVersion: 1,
    type: "loom-plugin",
    name: "fake",
    title: "Fake",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "./plugin.js",
    provides: { tabs: [{ id: "x", title: "X" }] },
    ...overrides,
  };
}

function discovered(
  installDir: string,
  m: Partial<LoomPluginManifest>,
): DiscoveredManifest {
  return {
    manifest: manifest(m),
    installDir,
    manifestPath: join(installDir, "plugin.json"),
  };
}

describe("isApiCompatible", () => {
  it("same major is compatible", () => {
    expect(isApiCompatible("1.0", "1.0")).toBe(true);
    expect(isApiCompatible("^1.2", "1.0")).toBe(true);
    expect(isApiCompatible("~1.2.3", "1.0")).toBe(true);
    expect(isApiCompatible("1", "1.0")).toBe(true);
  });

  it("different major is incompatible", () => {
    expect(isApiCompatible("2.0", "1.0")).toBe(false);
    expect(isApiCompatible("^2.0", "1.0")).toBe(false);
  });

  it("garbage is incompatible", () => {
    expect(isApiCompatible("abc", "1.0")).toBe(false);
    expect(isApiCompatible("", "1.0")).toBe(false);
    expect(isApiCompatible("1.0", "xyz")).toBe(false);
  });
});

describe("loadPlugins", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loom-load-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePlugin(name: string, body: string): string {
    const installDir = join(dir, name);
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, "plugin.js"), body, "utf8");
    return installDir;
  }

  it("loads a real .js module from disk into the registry", async () => {
    const installDir = writePlugin(
      "fake",
      `export const plugin = { id: "fake", title: "Fake", tabs: [{ id: "x", title: "X" }], load: () => ({}) };`,
    );
    const { plugins, errors } = await loadPlugins([
      discovered(installDir, { name: "fake" }),
    ]);
    expect(errors).toEqual([]);
    expect(plugins.map((p) => p.id)).toEqual(["fake"]);
    expect(plugins[0].title).toBe("Fake");
  });

  it("broken module (non-existent file) → error, the rest still load", async () => {
    const okDir = writePlugin(
      "good",
      `export const plugin = { id: "good", title: "Good", tabs: [], load: () => ({}) };`,
    );
    const missingDir = join(dir, "missing"); // the file does not exist
    const { plugins, errors } = await loadPlugins([
      discovered(missingDir, { name: "missing", entry: "./nope.js" }),
      discovered(okDir, { name: "good" }),
    ]);
    expect(plugins.map((p) => p.id)).toEqual(["good"]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("missing");
  });

  it("syntax error in the module → error, does not crash", async () => {
    const badDir = writePlugin("bad", `export const plugin = { id: `);
    const { plugins, errors } = await loadPlugins([
      discovered(badDir, { name: "bad" }),
    ]);
    expect(plugins).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it("id ≠ manifest.name → skip + error", async () => {
    const d = writePlugin(
      "mismatch",
      `export const plugin = { id: "wrong", title: "W", tabs: [], load: () => ({}) };`,
    );
    const { plugins, errors } = await loadPlugins([
      discovered(d, { name: "mismatch" }),
    ]);
    expect(plugins).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("does not match");
  });

  it("apiVersion 2.0 → skip + error (the code is not imported)", async () => {
    const d = writePlugin(
      "v2",
      `export const plugin = { id: "v2", title: "V2", tabs: [], load: () => ({}) };`,
    );
    const { plugins, errors } = await loadPlugins([
      discovered(d, { name: "v2", apiVersion: "2.0" }),
    ]);
    expect(plugins).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("apiVersion");
  });

  it("missing tabs / load → skip + error", async () => {
    const d = writePlugin(
      "notabs",
      `export const plugin = { id: "notabs", title: "N", load: () => ({}) };`,
    );
    const { plugins, errors } = await loadPlugins([
      discovered(d, { name: "notabs" }),
    ]);
    expect(plugins).toEqual([]);
    expect(errors[0]).toContain("tabs");
  });
});
