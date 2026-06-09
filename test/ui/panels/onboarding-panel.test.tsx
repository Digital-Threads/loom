import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { OnboardingPanel } from "../../../src/ui/panels/OnboardingPanel.js";

describe("OnboardingPanel render smoke", () => {
  it("contains the key onboarding phrases", () => {
    const { lastFrame } = render(<OnboardingPanel />);
    const f = lastFrame()!;
    expect(f).toContain("Loom");
    expect(f).toContain("Catalog");
    expect(f).toContain("loom plugin add");
  });
});
