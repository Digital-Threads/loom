import { describe, it, expect } from "vitest";
import { collectPackInput } from "../../../src/core/pack/collect-pack.js";

describe("collectPackInput", () => {
  it("использует инъектированные loadData/readConfig", async () => {
    const data = { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [],
      taskEvents: [], tasks: [], projectId: "", errors: [] } as any;
    const input = await collectPackInput({
      loadData: async () => data,
      readConfig: () => ({ projectName: "inj", activeTaskId: "tj-1" }),
    });
    expect(input.data).toBe(data);
    expect(input.config.projectName).toBe("inj");
    expect(input.config.activeTaskId).toBe("tj-1");
  });
});
