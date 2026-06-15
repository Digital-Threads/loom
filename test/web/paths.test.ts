import { describe, it, expect } from "vitest";
import { filePaths } from "../../web/src/paths.js";

describe("filePaths", () => {
  it("extracts paths with a dir and extension", () => {
    expect(filePaths("saved to .docs/plans/2026-06-15-foo-sdd.md")).toEqual([".docs/plans/2026-06-15-foo-sdd.md"]);
    expect(filePaths("edited src/web/api.ts and web/src/App.tsx")).toEqual(["src/web/api.ts", "web/src/App.tsx"]);
  });

  it("strips trailing prose punctuation", () => {
    expect(filePaths("see src/a.ts, then src/b.ts.")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("ignores prose without a path shape", () => {
    expect(filePaths("this is e.g. a sentence. no files here")).toEqual([]);
  });

  it("dedupes repeats", () => {
    expect(filePaths("src/x.ts and again src/x.ts")).toEqual(["src/x.ts"]);
  });
});
