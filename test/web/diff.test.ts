import { describe, it, expect } from "vitest";
import { diffLineKind } from "../../web/src/diff.js";

describe("diffLineKind", () => {
  it("classifies hunk, meta, add, del, context", () => {
    expect(diffLineKind("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(diffLineKind("diff --git a/x b/x")).toBe("meta");
    expect(diffLineKind("--- a/x")).toBe("meta");
    expect(diffLineKind("+++ b/x")).toBe("meta");
    expect(diffLineKind("+added line")).toBe("add");
    expect(diffLineKind("-removed line")).toBe("del");
    expect(diffLineKind(" unchanged")).toBe("ctx");
  });

  it("treats the +++/--- file headers as meta, not add/del", () => {
    expect(diffLineKind("+++ b/file.ts")).toBe("meta");
    expect(diffLineKind("--- a/file.ts")).toBe("meta");
  });
});
