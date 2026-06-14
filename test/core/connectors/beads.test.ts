import { describe, it, expect } from "vitest";
import { beadsConnector } from "../../../src/core/connectors/beads.js";

describe("beadsConnector (D5.4)", () => {
  it("maps bd json to drafts (injected run)", () => {
    const c = beadsConnector({ run: () => JSON.stringify([{ title: "Fix bug", description: "d" }, { noTitle: true }, { title: "Feature" }]) });
    const drafts = c.import();
    expect(drafts.map((d) => d.title)).toEqual(["Fix bug", "Feature"]);
    expect(drafts[0].description).toBe("d");
  });
  it("returns [] on bad output", () => {
    expect(beadsConnector({ run: () => "not json" }).import()).toEqual([]);
  });
});
