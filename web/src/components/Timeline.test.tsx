import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import type { LoomClient, TimelineEvent } from "../api";

function mkClient(events: TimelineEvent[] = []) {
  return {
    timeline: vi.fn(() => Promise.resolve(events)),
    boardMetrics: vi.fn(() => Promise.resolve({ used: 0, saved: 0 })),
    agentMetrics: vi.fn(() => Promise.resolve({ agents: [], failures: [] })),
  } as unknown as LoomClient;
}

describe("Timeline", () => {
  it("renders e.message in the row when present", async () => {
    const events: TimelineEvent[] = [
      { ts: 1000, source: "loom", type: "session.start", message: "task started ok" },
    ];
    render(<Timeline client={mkClient(events)} />);
    expect(await screen.findByText(/task started ok/, { selector: ".tl-meta" })).toBeInTheDocument();
  });

  it("applies the warn class to a row with severity=error", async () => {
    const events: TimelineEvent[] = [
      { ts: 1000, source: "loom", type: "session.error", severity: "error", message: "something failed" },
    ];
    const { container } = render(<Timeline client={mkClient(events)} />);
    await screen.findByText("session.error");
    expect(container.querySelector(".tl-row.warn")).not.toBeNull();
  });

  it("does not apply warn to a normal-severity row", async () => {
    const events: TimelineEvent[] = [
      { ts: 1000, source: "loom", type: "session.start" },
    ];
    const { container } = render(<Timeline client={mkClient(events)} />);
    await screen.findByText("session.start");
    expect(container.querySelector(".tl-row.warn")).toBeNull();
  });
});
