import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { OnboardingPanel } from "../../../src/ui/panels/OnboardingPanel.js";

describe("OnboardingPanel render smoke", () => {
  it("содержит ключевые фразы онбординга", () => {
    const { lastFrame } = render(<OnboardingPanel />);
    const f = lastFrame()!;
    expect(f).toContain("Loom");
    expect(f).toContain("Плагины");
    expect(f).toContain("loom plugin add");
  });
});
