import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, rmSync as rm } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeWitness, verifyWitness, hashFile } from "../../../src/core/extensibility/verify.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loom-verify-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "plugin.json"), '{"name":"x"}');
  writeFileSync(join(dir, "src", "adapter.js"), "export const a = 1;");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("extensibility/verify", () => {
  it("hashFile returns null for missing, hex for present", () => {
    expect(hashFile(join(dir, "nope"))).toBeNull();
    expect(hashFile(join(dir, "plugin.json"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeWitness then verifyWitness passes for untouched files", () => {
    const w = computeWitness(dir, ["plugin.json", "src/adapter.js"]);
    expect(Object.keys(w)).toHaveLength(2);
    expect(verifyWitness(dir, w)).toEqual({ ok: true, drifted: [], missing: [] });
  });

  it("detects a drifted (modified) file", () => {
    const w = computeWitness(dir, ["plugin.json", "src/adapter.js"]);
    writeFileSync(join(dir, "src", "adapter.js"), "export const a = 666; // tampered");
    expect(verifyWitness(dir, w)).toMatchObject({ ok: false, drifted: ["src/adapter.js"], missing: [] });
  });

  it("detects a missing file", () => {
    const w = computeWitness(dir, ["plugin.json", "src/adapter.js"]);
    rm(join(dir, "plugin.json"));
    expect(verifyWitness(dir, w)).toMatchObject({ ok: false, missing: ["plugin.json"] });
  });

  it("computeWitness skips files that don't exist", () => {
    const w = computeWitness(dir, ["plugin.json", "ghost.js"]);
    expect(Object.keys(w)).toEqual(["plugin.json"]);
  });
});
