import { describe, it, expect } from "vitest";
import { deriveProjectId, resolveProjectRoot } from "../../../src/core/workspace/project-id.js";
import { createHash } from "node:crypto";

describe("LP8 deriveProjectId — Loom's own stable label", () => {
  it("id = first 16 hex of the path's sha256 (deterministic function)", () => {
    const p = "/tmp/some/project";
    const expected = createHash("sha256").update(p).digest("hex").slice(0, 16);
    expect(deriveProjectId(p)).toBe(expected);
  });
  it("deterministic and 16 hex chars long", () => {
    const a = deriveProjectId("/tmp/x");
    expect(a).toBe(deriveProjectId("/tmp/x"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("resolveProjectRoot returns an absolute path for a path inside the repo", () => {
    const root = resolveProjectRoot(process.cwd());
    expect(root.startsWith("/")).toBe(true);
  });
  it("resolveProjectRoot returns the path itself for a non-git path", () => {
    expect(resolveProjectRoot("/tmp")).toBe("/tmp");
  });
});
