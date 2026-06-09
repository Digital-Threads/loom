import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { InputModeContext } from "../../../src/ui/input/InputModeContext.js";
import { ViewRenderer } from "../../../src/ui/views/ViewRenderer.js";
import type { LoomPlugin, ViewSpec } from "../../../src/core/plugins/types.js";

const tick = () => new Promise((r) => setTimeout(r, 40));

function harness(run: ReturnType<typeof vi.fn>) {
  const plugin = {
    id: "t",
    title: "t",
    category: "memory",
    tabs: [{ id: "x", title: "X" }],
    load: () => ({}),
    actions: [
      {
        id: "mk",
        label: "make",
        prompt: [
          { key: "title", label: "Title" },
          { key: "goal", label: "Goal" },
        ],
        run,
      },
    ],
  } as unknown as LoomPlugin;
  const spec: ViewSpec = {
    kind: "table",
    source: "rows",
    rowKey: "id",
    columns: [{ value: "id" }],
    actions: [{ key: "o", actionId: "mk" }],
  } as unknown as ViewSpec;
  const data = { rows: [{ id: "r1" }] } as never;
  return { plugin, spec, data };
}

describe("ViewRenderer: prompt-mode action", () => {
  it("collects the fields and calls run with typed args", async () => {
    const run = vi.fn(() => ({ ok: true }));
    const { plugin, spec, data } = harness(run);
    const { stdin, lastFrame, unmount } = render(
      <InputModeContext.Provider value={{ capturing: false, setCapturing: () => {} }}>
        <ViewRenderer plugin={plugin} spec={spec} data={data} />
      </InputModeContext.Provider>,
    );
    await tick();
    stdin.write("o");
    await tick(); // open the prompt (field 1)
    expect(lastFrame()).toContain("Title");
    stdin.write("hi");
    await tick();
    stdin.write("\r");
    await tick(); // submit field 1 → field 2
    expect(lastFrame()).toContain("Goal");
    stdin.write("g");
    await tick();
    stdin.write("\r");
    await tick(); // submit field 2 → run
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({ title: "hi", goal: "g" });
    // the prompt closed — the list is visible again (the input field is gone).
    expect(lastFrame()).toContain("r1");
    expect(lastFrame()).not.toContain("Goal");
    unmount();
  });

  it("Esc cancels the prompt without calling run", async () => {
    const run = vi.fn(() => ({ ok: true }));
    const { plugin, spec, data } = harness(run);
    const { stdin, unmount } = render(
      <InputModeContext.Provider value={{ capturing: false, setCapturing: () => {} }}>
        <ViewRenderer plugin={plugin} spec={spec} data={data} />
      </InputModeContext.Provider>,
    );
    await tick();
    stdin.write("o");
    await tick();
    stdin.write("\x1b"); // Esc
    await tick();
    expect(run).not.toHaveBeenCalled();
    unmount();
  });
});
