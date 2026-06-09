import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";

// Isolate the data source: on this machine the real plugins read live data
// (aimux ~/.aimux, token-pilot, task-journal), so the workspace is never empty.
// We mock the loader → an empty workspace, to deterministically test the empty start
// (empty → the Catalog tab is active) on any machine.
vi.mock("../../src/core/data/loader.js", () => {
  const empty = {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
  };
  return {
    loadWorkspaceData: () => Promise.resolve(empty),
    isWorkspaceEmpty: () => true,
  };
});

// CatalogPanel in a useEffect calls detectLatest(item, deps) with the default deps, whose
// run = execFileSync (a SYNCHRONOUS spawn of npm/claude/which, 5000ms timeout per call).
// In a unit test this means: (a) extra real I/O, (b) under the suite's parallel load
// synchronous spawns block the event loop → the waiting timer starves → the test hits
// the 5-sec vitest timeout (that was the flake ~1/6). We mock the runner → an instant no-op
// run, zero spawns. buildCatalog still returns items from loomRegistry
// ("Token Pilot" renders synchronously, independent of detect).
vi.mock("../../src/core/install/runner.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/core/install/runner.js")>();
  const instant = () => ({ ok: false, stdout: "", stderr: "" });
  return {
    ...actual,
    defaultRun: instant,
    defaultDeps: () => ({ dataDir: "/tmp/loom-catalog-test", run: instant }),
  };
});

import { App } from "../../src/ui/App.js";

// Ink commits frames on a timer, while the active tab arrives async
// (loadWorkspaceData → setActive(Catalog) → re-render → commit). So we wait for
// a CONDITION, not a fixed time: we poll lastFrame() until the needed
// fragment, with timeout headroom. This removes the timing dependency under load.
async function waitForFrame(
  lastFrame: () => string | undefined,
  needle: string,
  timeoutMs = 4000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = lastFrame() ?? "";
  while (!frame.includes(needle) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    frame = lastFrame() ?? "";
  }
  return frame;
}

describe("App: numeric tab hotkeys", () => {
  it("digit 1 switches to the Overview tab", async () => {
    const { lastFrame, stdin, unmount } = render(<App />);
    await waitForFrame(lastFrame, "Token Pilot"); // waited for the catalog (empty start)
    stdin.write("1");
    const frame = await waitForFrame(lastFrame, "Welcome to Loom");
    expect(frame).toContain("Welcome to Loom");
    unmount();
  });
});
