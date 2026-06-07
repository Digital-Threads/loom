import { describe, it, expect } from "vitest";
import { loadWorkspaceData } from "../../../src/core/data/loader.js";

describe("loader", () => {
  it("грузит данные асинхронно и не бросает при ошибке плагина", async () => {
    const data = await loadWorkspaceData();
    expect(data).toHaveProperty("subscriptions");
    expect(data).toHaveProperty("sessions");
    expect(data).toHaveProperty("health");
    expect(data).toHaveProperty("errors");
    expect(Array.isArray(data.errors)).toBe(true);
  });
});
