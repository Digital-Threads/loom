import { describe, it, expect } from "vitest";
import { resolveStageModel, modelLane, STAGE_MODEL } from "../../../src/core/pipeline/stage-model.js";

describe("resolveStageModel", () => {
  it("maps the thinking stages to opus and the mechanical ones to haiku", () => {
    expect(resolveStageModel("analysis")).toBe("opus");
    expect(resolveStageModel("spec")).toBe("opus");
    expect(resolveStageModel("review")).toBe("opus");
    expect(resolveStageModel("impl")).toBe("sonnet");
    expect(resolveStageModel("qa")).toBe("haiku");
    expect(resolveStageModel("done")).toBe("haiku");
  });

  it("an explicit override wins over everything", () => {
    expect(resolveStageModel("impl", { override: "claude-opus-4-8" })).toBe("claude-opus-4-8");
    expect(resolveStageModel("qa", { override: "opus", relocations: 0 })).toBe("opus");
  });

  it("escalates a stubborn impl to opus after enough relocations", () => {
    expect(resolveStageModel("impl", { relocations: 1 })).toBe("sonnet"); // below threshold
    expect(resolveStageModel("impl", { relocations: 2 })).toBe("opus"); // escalated
    // escalation is impl-only — other stages keep their tier
    expect(resolveStageModel("qa", { relocations: 5 })).toBe("haiku");
  });

  it("falls back to a balanced tier for an unknown stage", () => {
    expect(resolveStageModel("mystery")).toBe("sonnet");
  });

  it("a non-Claude profile's pinned model wins over the Claude tier policy", () => {
    // opus/sonnet/haiku are Claude tiers — a GLM/Codex profile pins its own model.
    expect(resolveStageModel("analysis", { profileModel: "glm-4.6" })).toBe("glm-4.6");
    expect(resolveStageModel("qa", { profileModel: "glm-4.6" })).toBe("glm-4.6");
    // the Claude-only impl escalation does not apply off-Claude
    expect(resolveStageModel("impl", { profileModel: "glm-4.6", relocations: 5 })).toBe("glm-4.6");
  });

  it("an explicit override still wins over the profile model", () => {
    expect(resolveStageModel("impl", { override: "o1-pro", profileModel: "glm-4.6" })).toBe("o1-pro");
  });

  it("has a tier for every standard stage", () => {
    for (const s of ["analysis", "brainstorm", "spec", "rd", "impl", "review", "qa", "pr", "done"]) {
      expect(STAGE_MODEL[s]).toBeDefined();
    }
  });
});

describe("modelLane", () => {
  it("same-tier stages share a lane; a different tier forks a new one", () => {
    expect(modelLane("analysis")).toBe(modelLane("review")); // both opus → same lane
    expect(modelLane("spec")).toBe(modelLane("brainstorm")); // both opus
    expect(modelLane("impl")).not.toBe(modelLane("review")); // sonnet vs opus
    expect(modelLane("qa")).not.toBe(modelLane("impl")); // haiku vs sonnet
  });

  it("an override forks its own lane", () => {
    expect(modelLane("impl", { override: "opus" })).toBe("opus");
    expect(modelLane("impl", { override: "opus" })).not.toBe(modelLane("impl"));
  });
});
