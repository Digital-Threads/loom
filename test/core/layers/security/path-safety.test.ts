import { describe, it, expect } from "vitest";
import { safeResolve, safeResolveAny } from "../../../../src/core/layers/security/path-safety.js";

describe("path-safety", () => {
  it("resolves a relative path inside the root", () => {
    expect(safeResolve("/home/u/repo", "docs/x.md")).toBe("/home/u/repo/docs/x.md");
    expect(safeResolve("/home/u/repo", "./a/b.ts")).toBe("/home/u/repo/a/b.ts");
  });

  it("rejects ../ traversal out of the root", () => {
    expect(safeResolve("/home/u/repo", "../secrets")).toBeNull();
    expect(safeResolve("/home/u/repo", "a/../../etc/passwd")).toBeNull();
  });

  it("rejects an absolute path outside the root, allows inside", () => {
    expect(safeResolve("/home/u/repo", "/etc/passwd")).toBeNull();
    expect(safeResolve("/home/u/repo", "/home/u/repo/in.md")).toBe("/home/u/repo/in.md");
  });

  it("does not treat a sibling prefix as inside", () => {
    expect(safeResolve("/home/u/repo", "/home/u/repo-evil/x")).toBeNull();
  });

  it("safeResolveAny picks the first containing root, null when it escapes all", () => {
    expect(safeResolveAny(["/a", "/b"], "y.md")).toBe("/a/y.md");
    expect(safeResolveAny(["/a", "/b"], "../../etc/passwd")).toBeNull();
  });
});
