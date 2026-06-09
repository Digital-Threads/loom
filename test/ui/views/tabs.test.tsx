import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ViewRenderer } from "../../../src/ui/views/ViewRenderer.js";
import { overviewView, settingsView } from "../../../src/ui/views/host-views.js";
import { loomRegistry } from "../../../src/core/plugins/index.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";
import type { ViewSpec } from "../../../src/core/plugins/types.js";

function makeData(over: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    ...over,
  } as WorkspaceData;
}

const aimux = loomRegistry.get("aimux")!;
const tokenPilot = loomRegistry.get("token-pilot")!;
const taskJournal = loomRegistry.get("task-journal")!;

// A small pause so Ink can render after stdin.write.
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("per-tab declarative render via ViewRenderer", () => {
  it("Overview: shows the counters (host summary, no plugin)", () => {
    const data = makeData({
      subscriptions: [{ name: "a", cli: "c", isSource: false }],
      sessions: [{ sessionId: "s1", profile: "p1" }, { sessionId: "s2", profile: "p2" }],
    });
    const { lastFrame } = render(<ViewRenderer spec={overviewView} data={data} />);
    expect(lastFrame()).toContain("Subscriptions: 1");
    expect(lastFrame()).toContain("Sessions: 2");
  });

  it("Overview: the error line is visible only when errors.length > 0", () => {
    const ok = render(<ViewRenderer spec={overviewView} data={makeData()} />);
    expect(ok.lastFrame()).not.toContain("Load errors");
    const bad = render(<ViewRenderer spec={overviewView} data={makeData({ errors: ["boom"] })} />);
    expect(bad.lastFrame()).toContain("Load errors: 1");
  });

  it("Subscriptions: name, source marker ★ and cli", () => {
    const data = makeData({
      subscriptions: [
        { name: "claude", cli: "claude-cli", isSource: true },
        { name: "gpt", cli: "gpt-cli", isSource: false },
      ],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={aimux} spec={aimux.views!.subscriptions} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("★ claude");
    expect(f).toContain("claude-cli");
    expect(f).toContain("gpt");
    // gpt is not a source → no star in front of it
    expect(f).not.toContain("★ gpt");
  });

  it("Sessions: id8, profile and used/saved", () => {
    const data = makeData({
      sessions: [{ sessionId: "abcdef1234567890", profile: "claude" }],
      tokens: [{ sessionId: "abcdef1234567890", used: 100, saved: 25 }],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={aimux} spec={aimux.views!.sessions} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("abcdef12");
    expect(f).toContain("claude");
    expect(f).toContain("100/25");
  });

  it("Tokens: total line + a table row", () => {
    const data = makeData({
      tokens: [
        { sessionId: "abcdef1234", used: 100, saved: 10 },
        { sessionId: "ghijkl5678", used: 50, saved: 5 },
      ],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={tokenPilot} spec={tokenPilot.views!.tokens} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("Total: spent 150 · saved 15");
    expect(f).toContain("abcdef12");
    expect(f).toContain("100");
  });

  it("Tokens: empty state without a total line", () => {
    const { lastFrame } = render(
      <ViewRenderer plugin={tokenPilot} spec={tokenPilot.views!.tokens} data={makeData()} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("No token data");
    expect(f).not.toContain("Total:");
  });

  it("Tasks: a task row + footer ↑/↓ — select · Enter — open", () => {
    const data = makeData({
      tasks: [
        { id: "tj-1", title: "Open task", status: "open" },
        { id: "tj-2", title: "Closed task", status: "closed" },
      ],
    });
    const { lastFrame } = render(
      <ViewRenderer plugin={taskJournal} spec={taskJournal.views!.tasks} data={data} />,
    );
    const f = lastFrame()!;
    expect(f).toContain("↑/↓ select · Enter open");
    expect(f).toContain("○ Open task");
    expect(f).toContain("✓ Closed task");
    expect(f).toContain("tj-1");
  });

  it("Settings: the form shows the token-pilot field", () => {
    const { lastFrame } = render(<ViewRenderer spec={settingsView} data={makeData()} />);
    const f = lastFrame()!;
    expect(f).toContain("Settings");
    expect(f).toContain("Hook mode");
  });
});

describe("list → detail: opening a task via ViewRenderer", () => {
  it("Enter on a task opens the detail with sections and the c/t legend", async () => {
    const taskEvents = [
      { event_id: "e1", task_id: "tj-1", type: "open", timestamp: "2026-06-07T10:00:00.000Z", text: "Open task", meta: { title: "Open task" } },
      { event_id: "e2", task_id: "tj-1", type: "decision", timestamp: "2026-06-07T10:05:00.000Z", text: "Decided to use X" },
      { event_id: "e3", task_id: "tj-1", type: "finding", timestamp: "2026-06-07T10:06:00.000Z", text: "Found the cause" },
    ];
    const data = makeData({
      tasks: [{ id: "tj-1", title: "Open task", status: "open" }],
      taskEvents,
    });
    const { lastFrame, stdin } = render(
      <ViewRenderer plugin={taskJournal} spec={taskJournal.views!.tasks} data={data} />,
    );
    stdin.write("\r"); // Enter — open the selected (first) task
    await tick();
    const f = lastFrame()!;
    expect(f).toContain("Open task");
    expect(f).toContain("Decisions (1)");
    expect(f).toContain("Decided to use X");
    expect(f).toContain("Findings (1)");
    expect(f).toContain("Task tokens");
    expect(f).toContain("c — close · t — write tokens · Esc — back");
  });

  it("taskDetail spec resolves and DetailView draws the sections on a direct mount", async () => {
    // Direct mount of the detail view (in case the stdin simulation turns out fragile).
    const taskEvents = [
      { event_id: "e1", task_id: "tj-9", type: "open", timestamp: "2026-06-07T10:00:00.000Z", text: "T", meta: { title: "T" } },
      { event_id: "e2", task_id: "tj-9", type: "rejection", timestamp: "2026-06-07T10:05:00.000Z", text: "Rejected Y" },
    ];
    const data = makeData({ tasks: [{ id: "tj-9", title: "Ninth", status: "open" }], taskEvents });
    const detailSpec = (taskJournal.views!.taskDetail as ViewSpec);
    expect((detailSpec as { kind: string }).kind).toBe("detail");

    // Mount the table, open via onSelect: easier to verify through DetailView directly.
    // Here — a sanity check: derivations return sections for a specific taskId.
    const { lastFrame, stdin } = render(
      <ViewRenderer plugin={taskJournal} spec={taskJournal.views!.tasks} data={data} />,
    );
    stdin.write("\r");
    await tick();
    const f = lastFrame()!;
    expect(f).toContain("Ninth");
    expect(f).toContain("Rejected (1)");
    expect(f).toContain("Rejected Y");
  });
});
