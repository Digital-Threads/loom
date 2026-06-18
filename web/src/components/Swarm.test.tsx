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

describe("Swarm", () => {
  it("shows Default attempts from the swarm.attempts setting", async () => {
    const client = mkClient({ settings: vi.fn(() => Promise.resolve({ "swarm.attempts": 5 })) });
    render(<Swarm client={client} />);
    const input = (await screen.findByLabelText("Default attempts")) as HTMLInputElement;
    expect(input.value).toBe("5");
  });

  it("falls back to 3 attempts when the setting is absent", async () => {
    render(<Swarm client={mkClient()} />);
    const input = (await screen.findByLabelText("Default attempts")) as HTMLInputElement;
    expect(input.value).toBe("3");
  });

  it("saves a new attempts value on blur", async () => {
    const user = userEvent.setup();
    const client = mkClient();
    render(<Swarm client={client} />);
    const input = await screen.findByLabelText("Default attempts");
    await user.clear(input);
    await user.type(input, "7");
    await user.tab();
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalledWith("swarm.attempts", 7));
  });

  it("normalises an invalid attempts value to at least 1", async () => {
    const user = userEvent.setup();
    const client = mkClient();
    render(<Swarm client={client} />);
    const input = await screen.findByLabelText("Default attempts");
    await user.clear(input);
    await user.type(input, "0");
    await user.tab();
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalledWith("swarm.attempts", 1));
  });

  it("clamps an oversized attempts value to the upper cap", async () => {
    const user = userEvent.setup();
    const client = mkClient();
    render(<Swarm client={client} />);
    const input = await screen.findByLabelText("Default attempts");
    await user.clear(input);
    await user.type(input, "100000");
    await user.tab();
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalledWith("swarm.attempts", 50));
  });

  it("keeps the typed value when saving fails (does not show it as saved)", async () => {
    const user = userEvent.setup();
    const client = mkClient({ saveSetting: vi.fn(() => Promise.reject(new Error("nope"))) });
    render(<Swarm client={client} />);
    const input = (await screen.findByLabelText("Default attempts")) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "9");
    await user.tab();
    await waitFor(() => expect(client.saveSetting).toHaveBeenCalled());
    // the field is NOT rewritten to a "saved" value — the raw input stays for retry
    expect(input.value).toBe("9");
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
