import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostBar } from "./CostBar";

describe("CostBar — token-pilot read savings are labelled, not conflated with spend", () => {
  const costs = [
    { source: "aimux", metric: "spent", value: 1.34, exact: 1 },
    { source: "token-pilot", metric: "used", value: 21000, exact: 1 },
    { source: "token-pilot", metric: "saved", value: 832000, exact: 1 },
  ];

  it("shows spend and labels the savings as token-pilot read-tokens (not 'tokens used')", () => {
    render(<CostBar costs={costs} />);
    expect(screen.getByText("$1.34")).toBeInTheDocument(); // real spend, primary
    expect(screen.getByText(/token-pilot saved/i)).toBeInTheDocument();
    expect(screen.getByText(/read-tokens/i)).toBeInTheDocument(); // not bare "tokens"
    expect(screen.getByText(/832k/)).toBeInTheDocument(); // the saved amount, attributed to token-pilot
  });

  it("renders a dash when there are no cost rows", () => {
    render(<CostBar costs={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
