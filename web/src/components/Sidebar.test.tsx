import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { LoomClient } from "../api";

const client = { attention: () => Promise.resolve([]), settings: () => Promise.resolve({}) } as unknown as LoomClient;

describe("Sidebar a11y", () => {
  it("marks the active nav item with aria-current=page", () => {
    render(<Sidebar client={client} view="security" onNav={() => {}} open={false} />);
    expect(screen.getByRole("button", { name: /Security/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Board/ })).not.toHaveAttribute("aria-current");
  });

  it("exposes a navigation landmark", () => {
    render(<Sidebar client={client} view="board" onNav={() => {}} open={false} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("makes 'needs attention' a real button (keyboard reachable)", () => {
    render(<Sidebar client={client} view="board" onNav={() => {}} open={false} />);
    expect(screen.getByRole("button", { name: /Needs attention/ })).toBeInTheDocument();
  });
});
