import { describe, it, expect } from "vitest";
import { CONNECTORS, selectConnector } from "../../../src/core/connectors/registry.js";

describe("connector registry (D5.5)", () => {
  it("lists beads and github with correct needsRepo", () => {
    const beads = CONNECTORS.find((c) => c.id === "beads");
    const github = CONNECTORS.find((c) => c.id === "github");
    expect(beads?.needsRepo).toBe(false);
    expect(github?.needsRepo).toBe(true);
  });
  it("selects connectors by id", () => {
    expect(selectConnector("beads")?.id).toBe("beads");
    expect(selectConnector("github", { repo: "owner/repo" })?.id).toBe("github");
  });
  it("returns undefined for an unknown id", () => {
    expect(selectConnector("nope")).toBeUndefined();
  });
});
