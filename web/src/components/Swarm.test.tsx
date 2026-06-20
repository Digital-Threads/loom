import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Swarm } from "./Swarm";
import type { LoomClient, TimelineEvent } from "../api";

function mkClient(over: Partial<LoomClient> = {}) {
  return {
    settings: vi.fn(() => Promise.resolve({} as Record<string, unknown>)),
    saveSetting: vi.fn(() => Promise.resolve({ ok: true })),
    timeline: vi.fn(() => Promise.resolve([] as TimelineEvent[])),
    ...over,
  } as unknown as LoomClient;
}

describe("Swarm (impl-as-swarm config)", () => {
  it("reflects swarm.impl from settings (enabled + attempts)", async () => {
    const client = mkClient({ settings: vi.fn(() => Promise.resolve({ "swarm.impl": { enabled: true, attempts: 4 } })) });
    render(<Swarm client={client} />);
    expect(((await screen.findByLabelText("Attempts")) as HTMLInputElement).value).toBe("4");
    expect(screen.getByText("on")).toBeInTheDocument(); // toggle reflects enabled
  });

  it("defaults attempts to 3 when swarm.impl is unset", async () => {
    render(<Swarm client={mkClient()} />);
    expect(((await screen.findByLabelText("Attempts")) as HTMLInputElement).value).toBe("3");
  });

  it("toggling on saves swarm.impl.enabled", async () => {
    const user = userEvent.setup();
    const client = mkClient();
    render(<Swarm client={client} />);
    await screen.findByLabelText("Attempts");
    await user.click(screen.getByText("off"));
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalledWith("swarm.impl", expect.objectContaining({ enabled: true })));
  });

  it("clamps attempts to the cap (5) on blur", async () => {
    const user = userEvent.setup();
    const client = mkClient();
    render(<Swarm client={client} />);
    const input = await screen.findByLabelText("Attempts");
    await user.clear(input); await user.type(input, "100"); await user.tab();
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalledWith("swarm.impl", expect.objectContaining({ attempts: 5 })));
  });

  it("saves perspectives as a trimmed, non-empty list", async () => {
    const user = userEvent.setup();
    const client = mkClient();
    render(<Swarm client={client} />);
    const input = await screen.findByLabelText("Perspectives");
    await user.type(input, " simplest , robust ,");
    await user.tab();
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalledWith("swarm.impl", expect.objectContaining({ perspectives: ["simplest", "robust"] })));
  });

  it("shows an empty-state when there are no swarm runs", async () => {
    render(<Swarm client={mkClient()} />);
    expect(await screen.findByText(/No swarm runs recorded yet/)).toBeInTheDocument();
  });

  it("lists swarm runs from the timeline and filters out non-swarm events", async () => {
    const events: TimelineEvent[] = [
      { ts: 1000, source: "loom", type: "swarm.run", message: "elected answer A", metrics: { attempts: 3, count: 2, total: 3, ratio: 0.6667 } },
      { ts: 2000, source: "loom", type: "session", message: "unrelated event" },
    ];
    const client = mkClient({ timeline: vi.fn(() => Promise.resolve(events)) });
    render(<Swarm client={client} />);
    expect(await screen.findByText(/elected answer A/)).toBeInTheDocument();
    expect(screen.getByText(/67% agreement/)).toBeInTheDocument();
    expect(screen.queryByText(/unrelated event/)).not.toBeInTheDocument();
  });
});
