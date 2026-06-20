import { describe, it, expect } from "vitest";
import { resolveQaMode } from "../../../src/core/quality/qa-mode.js";

describe("resolveQaMode", () => {
  it("defaults to minimal when nothing is set", () => {
    expect(resolveQaMode(undefined, undefined)).toBe("minimal");
    expect(resolveQaMode("minimal", "inherit")).toBe("minimal");
  });

  it("global default of full applies when the task inherits", () => {
    expect(resolveQaMode("full", "inherit")).toBe("full");
    expect(resolveQaMode("full", undefined)).toBe("full");
  });

  it("per-task override wins over the global default", () => {
    expect(resolveQaMode("minimal", "full")).toBe("full"); // opt one task in
    expect(resolveQaMode("full", "minimal")).toBe("minimal"); // opt one task out
  });

  it("garbage falls back to minimal", () => {
    expect(resolveQaMode("nope", "maybe")).toBe("minimal");
  });
});
