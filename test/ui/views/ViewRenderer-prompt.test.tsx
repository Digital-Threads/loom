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
          { key: "title", label: "Заголовок" },
          { key: "goal", label: "Цель" },
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

describe("ViewRenderer: prompt-режим action", () => {
  it("собирает поля и зовёт run с typed-args", async () => {
    const run = vi.fn(() => ({ ok: true }));
    const { plugin, spec, data } = harness(run);
    const { stdin, lastFrame, unmount } = render(
      <InputModeContext.Provider value={{ capturing: false, setCapturing: () => {} }}>
        <ViewRenderer plugin={plugin} spec={spec} data={data} />
      </InputModeContext.Provider>,
    );
    await tick();
    stdin.write("o");
    await tick(); // открыть prompt (поле 1)
    expect(lastFrame()).toContain("Заголовок");
    stdin.write("hi");
    await tick();
    stdin.write("\r");
    await tick(); // submit поле 1 → поле 2
    expect(lastFrame()).toContain("Цель");
    stdin.write("g");
    await tick();
    stdin.write("\r");
    await tick(); // submit поле 2 → run
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toMatchObject({ title: "hi", goal: "g" });
    // prompt закрылся — снова виден список (поле-ввод исчез).
    expect(lastFrame()).toContain("r1");
    expect(lastFrame()).not.toContain("Цель");
    unmount();
  });

  it("Esc отменяет prompt без вызова run", async () => {
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
