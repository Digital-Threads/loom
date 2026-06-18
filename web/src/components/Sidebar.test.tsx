import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// A fake browser Notification: granted permission, records every construction.
let built: { title: string }[] = [];
class FakeNotification {
  static permission = "granted";
  static requestPermission = vi.fn(async () => "granted");
  constructor(public title: string) { built.push({ title }); }
}

function notifyClient(notifyEnabled: boolean): LoomClient {
  return {
    settings: () => Promise.resolve({ "notify.enabled": notifyEnabled }),
    attention: () => Promise.resolve([{ id: "t1", title: "needs you" }]),
  } as unknown as LoomClient;
}

describe("Sidebar notifications honour notify.enabled", () => {
  beforeEach(() => {
    built = [];
    (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
  afterEach(() => { delete (globalThis as unknown as { Notification?: unknown }).Notification; });

  it("fires a browser notification when enabled and items need attention", async () => {
    render(<Sidebar client={notifyClient(true)} view="board" onNav={() => {}} open />);
    await waitFor(() => expect(built.length).toBe(1));
    expect(built[0].title).toContain("Loom");
  });

  it("does not fire when notifications are disabled", async () => {
    render(<Sidebar client={notifyClient(false)} view="board" onNav={() => {}} open />);
    // let the settings + attention effects resolve, then assert nothing fired
    await new Promise((r) => setTimeout(r, 40));
    expect(built.length).toBe(0);
  });
});
