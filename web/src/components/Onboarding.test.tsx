import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";
import type { LoomClient } from "../api";

const okReport = { ok: true, tools: [{ name: "claude", found: true, hint: "" }], missing: [] };
const emptyWs = {
  subscriptions: [], sessions: [], health: [], tokens: [],
  tokenEvents: [], taskEvents: [], tasks: [], errors: [], projectId: "p",
};

function mkClient(over: Partial<Record<string, unknown>> = {}): LoomClient {
  return {
    doctor: () => Promise.resolve(okReport),
    workspace: () => Promise.resolve(emptyWs),
    addSubscription: vi.fn(() => Promise.resolve({ ok: true })),
    addProject: vi.fn(() => Promise.resolve({})),
    ...over,
  } as unknown as LoomClient;
}

describe("Onboarding (D2.2 first-run wizard)", () => {
  it("shows a loading state while the environment is being read", () => {
    const client = mkClient({ doctor: () => new Promise(() => {}) }); // never resolves
    render(<Onboarding client={client} onDone={() => {}} />);
    expect(screen.getByText(/Checking your environment/)).toBeTruthy();
  });

  it("prompts to add a subscription when there is no healthy profile", async () => {
    render(<Onboarding client={mkClient()} onDone={() => {}} />);
    expect(await screen.findByText(/No healthy aimux profile yet/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/profile name/)).toBeTruthy();
  });

  it("marks the subscription step ready when a healthy profile exists", async () => {
    const client = mkClient({
      workspace: () => Promise.resolve({ ...emptyWs, subscriptions: [{ name: "work" }], health: [{ profile: "work" }] }),
    });
    render(<Onboarding client={client} onDone={() => {}} />);
    expect(await screen.findByText(/Healthy profile: work/)).toBeTruthy();
    expect(screen.queryByText(/No healthy aimux profile yet/)).toBeNull();
  });

  it("shows an error with Retry when the environment read fails", async () => {
    const client = mkClient({ doctor: () => Promise.reject(new Error("boom")) });
    render(<Onboarding client={client} onDone={() => {}} />);
    expect(await screen.findByText(/Couldn't read your environment/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("calls onDone after the first project is added", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding client={mkClient()} onDone={onDone} />);
    const input = await screen.findByPlaceholderText("/path/to/repo");
    await user.type(input, "/repo");
    await user.click(screen.getByRole("button", { name: /Add project/ }));
    expect(onDone).toHaveBeenCalled();
  });
});
