import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { InputModeContext } from "../../../src/ui/input/InputModeContext.js";
import { ViewRenderer } from "../../../src/ui/views/ViewRenderer.js";
import { takeHandover } from "../../../src/core/handover.js";
import type { LoomPlugin, ViewSpec } from "../../../src/core/plugins/types.js";

const exitSpy = vi.fn();
vi.mock("ink", async (orig) => {
  const actual = await orig<typeof import("ink")>();
  return { ...actual, useApp: () => ({ exit: exitSpy }) };
});

const tick = () => new Promise((r) => setTimeout(r, 40));

describe("ViewRenderer: exit-and-handover", () => {
  it("action with handover unmounts Ink and registers the thunk", async () => {
    takeHandover(); // clear any leftover
    exitSpy.mockClear();
    const thunk = vi.fn(() => "launched");
    const plugin = {
      id: "t",
      title: "t",
      category: "accounts",
      tabs: [{ id: "x", title: "X" }],
      load: () => ({}),
      actions: [{ id: "go", label: "go", run: () => ({ ok: true, handover: thunk }) }],
    } as unknown as LoomPlugin;
    const spec = {
      kind: "table",
      source: "rows",
      rowKey: "id",
      columns: [{ value: "id" }],
      actions: [{ key: "l", actionId: "go" }],
    } as unknown as ViewSpec;
    const data = { rows: [{ id: "r1" }] } as never;
    const { stdin, unmount } = render(
      <InputModeContext.Provider value={{ capturing: false, setCapturing: () => {} }}>
        <ViewRenderer plugin={plugin} spec={spec} data={data} />
      </InputModeContext.Provider>,
    );
    await tick();
    stdin.write("l");
    await tick();
    expect(exitSpy).toHaveBeenCalled();
    const h = takeHandover();
    expect(h).toBeTruthy();
    expect(h!()).toBe("launched");
    expect(thunk).toHaveBeenCalled();
    unmount();
  });
});
