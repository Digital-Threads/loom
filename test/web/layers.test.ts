import { describe, it, expect } from "vitest";
import { layerSection, LAYER_SECTION } from "../../web/src/layers.js";
import { NAV_KEYS } from "../../web/src/nav.js";

describe("layerSection", () => {
  it("maps standalone-plugin layers to their menu section", () => {
    expect(layerSection("accounts")).toBe("accounts");
    expect(layerSection("efficiency")).toBe("tokens"); // id ≠ section key
    expect(layerSection("memory")).toBe("memory");
    expect(layerSection("security")).toBe("security");
    expect(layerSection("quality")).toBe("quality");
    expect(layerSection("swarm")).toBe("swarm");
  });

  it("maps inline layers that have a section", () => {
    expect(layerSection("knowledge")).toBe("knowledge");
    expect(layerSection("observability")).toBe("timeline");
    expect(layerSection("automation")).toBe("board");
  });

  it("returns undefined for a layer with no section", () => {
    expect(layerSection("learning")).toBeUndefined();
  });

  it("returns undefined for an unknown layer id", () => {
    expect(layerSection("nope")).toBeUndefined();
  });
});

describe("LAYER_SECTION integrity", () => {
  it("every mapped section is a real navigable menu section", () => {
    for (const section of Object.values(LAYER_SECTION)) {
      expect(NAV_KEYS).toContain(section);
    }
  });
});
