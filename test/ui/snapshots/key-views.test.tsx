import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { ViewRenderer } from "../../../src/ui/views/ViewRenderer.js";
import {
  overviewView,
  settingsView,
  tasksTokensView,
  timelineView,
} from "../../../src/ui/views/host-views.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

// A deterministic, populated fixture: fixed values, no Date.now/timers.
// We render the views the same way App does (the spec is passed straight to ViewRenderer,
// the overviewView array is normalized internally via asArray).
const fixture: WorkspaceData = {
  subscriptions: [
    { provider: "anthropic", plan: "max", seats: 1 },
    { provider: "openai", plan: "team", seats: 3 },
  ] as unknown as WorkspaceData["subscriptions"],
  sessions: [
    { id: "s1", provider: "anthropic", state: "active" },
  ] as unknown as WorkspaceData["sessions"],
  health: [] as unknown as WorkspaceData["health"],
  tokens: [
    { date: "2025-01-01", used: 1000, saved: 250 },
  ] as unknown as WorkspaceData["tokens"],
  tokenEvents: [],
  taskEvents: [
    {
      event_id: "e1",
      task_id: "t1",
      type: "decision",
      timestamp: "2025-01-01T10:00:00.000Z",
      text: "Chose Ink for the TUI",
      meta: { title: "Dashboard build" },
    },
  ],
  tasks: [
    { id: "t1", title: "Dashboard build", status: "open" },
    { id: "t2", title: "LP12 release", status: "closed" },
  ],
  errors: [],
  projectId: "loom-fixture",
};

describe("UI parity: snapshots of key views", () => {
  it("Overview renders stably", () => {
    const { lastFrame } = render(<ViewRenderer spec={overviewView} data={fixture} />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "Subscriptions: 2
      Sessions: 1
      Access / accounts: Subscriptions 2 · Sessions 1
      Memory / tasks: Tasks 2"
    `);
  });

  it("Timeline renders stably", () => {
    const { lastFrame } = render(<ViewRenderer spec={timelineView} data={fixture} />);
    expect(lastFrame()).toMatchInlineSnapshot(`"~2025-01-01T10:00:00.000Z  task-journal  decision    Chose Ink for the TUI"`);
  });

  it("Settings render stably", () => {
    const { lastFrame } = render(<ViewRenderer spec={settingsView} data={fixture} />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "[1mSettings[22m

      [1maimux[22m
      [2mno configurable options (write via actions)[22m

      [1mtoken-pilot[22m
      [7m► Hook mode: —[27m
        Line threshold for deny: —
        Reminder at session start: —
        Small file threshold (lines): —
        Cache size (MB): —
        Check for updates on startup: true

      [1mtask-journal[22m
      [2mno configurable options (write via actions)[22m

      [2m↑/↓ select · Enter edit/toggle · digits+Enter number · Backspace · Escape cancel[22m"
    `);
  });

  it("Tasks and tokens render stably", () => {
    const { lastFrame } = render(<ViewRenderer spec={tasksTokensView} data={fixture} />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "[2m↑/↓ select · Enter open[22m
      [1m                                                    Accuracy    Tokens (est.)[22m
      [7m○ Dashboard build                                     ≈ estimate  0/0[27m
      ✓ LP12 release                                        ≈ estimate  0/0"
    `);
  });
});
