import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateView } from "./StateView";

// Smoke test that proves the web component test harness works (jsdom + RTL +
// jest-dom). The a11y work builds on this.
describe("StateView", () => {
  it("renders the error message", () => {
    render(<StateView kind="error" msg="boom" />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("falls back to a default loading label", () => {
    render(<StateView kind="loading" />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });
});
