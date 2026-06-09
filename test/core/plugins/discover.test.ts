import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPlugins } from "../../../src/core/plugins/discover.js";

let root: string;

const validManifest = {
  schemaVersion: 1,
  type: "loom-plugin",
  name: "good",
  title: "Good",
  version: "1.0.0",
  apiVersion: "^1.0",
  entry: "./dist/adapter.js",
  provides: { tabs: [{ id: "g", title: "Good" }] },
};

function writePlugin(dir: string, name: string, version: string, content: string) {
  const d = join(dir, name, version);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "plugin.json"), content, "utf8");
  return d;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loom-discover-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("discoverPlugins", () => {
  it("non-existent directory → empty, no throw", () => {
    const r = discoverPlugins(join(root, "does-not-exist"));
    expect(r.found).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("finds the valid one, reports broken JSON and an invalid manifest", () => {
    const goodDir = writePlugin(root, "good", "1.0.0", JSON.stringify(validManifest));
    writePlugin(root, "broken", "1.0.0", "{ not json ");
    writePlugin(
      root,
      "invalid",
      "1.0.0",
      JSON.stringify({ ...validManifest, type: "nope", name: "invalid" }),
    );

    const r = discoverPlugins(root);

    expect(r.found).toHaveLength(1);
    expect(r.found[0].manifest.name).toBe("good");
    expect(r.found[0].installDir).toBe(goodDir);
    expect(r.found[0].manifestPath).toBe(join(goodDir, "plugin.json"));

    expect(r.errors).toHaveLength(2);
    expect(r.errors.some((e) => e.includes("broken"))).toBe(true);
    expect(r.errors.some((e) => e.includes("invalid"))).toBe(true);
  });

  it("a directory without plugin.json is ignored (not an error)", () => {
    mkdirSync(join(root, "empty", "1.0.0"), { recursive: true });
    const r = discoverPlugins(root);
    expect(r.found).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it("multiple versions of one name are both returned (duplicates are not collapsed here)", () => {
    writePlugin(root, "good", "1.0.0", JSON.stringify(validManifest));
    writePlugin(root, "good", "2.0.0", JSON.stringify({ ...validManifest, version: "2.0.0" }));
    const r = discoverPlugins(root);
    expect(r.found).toHaveLength(2);
    expect(r.errors).toEqual([]);
  });
});
