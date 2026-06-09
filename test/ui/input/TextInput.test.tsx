import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { InputModeContext } from "../../../src/ui/input/InputModeContext.js";
import { TextInput } from "../../../src/ui/input/TextInput.js";

function renderWithMode(ui: React.ReactElement) {
  const setCapturing = vi.fn();
  const utils = render(
    <InputModeContext.Provider value={{ capturing: false, setCapturing }}>
      {ui}
    </InputModeContext.Provider>,
  );
  return { ...utils, setCapturing };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("TextInput", () => {
  it("enables capture mode on mount", async () => {
    const { setCapturing, unmount } = renderWithMode(
      <TextInput onSubmit={() => {}} onCancel={() => {}} />,
    );
    await tick();
    expect(setCapturing).toHaveBeenCalledWith(true);
    unmount();
  });

  it("types characters and submits on Enter", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = renderWithMode(
      <TextInput onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await tick();
    stdin.write("abc");
    await tick();
    stdin.write("\r");
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("abc");
    unmount();
  });

  it("Backspace deletes the last character", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = renderWithMode(
      <TextInput onSubmit={onSubmit} onCancel={() => {}} />,
    );
    await tick();
    stdin.write("ab");
    await tick();
    stdin.write("\x7f");
    await tick();
    stdin.write("\r");
    await tick();
    expect(onSubmit).toHaveBeenCalledWith("a");
    unmount();
  });

  it("Esc cancels", async () => {
    const onCancel = vi.fn();
    const { stdin, unmount } = renderWithMode(
      <TextInput onSubmit={() => {}} onCancel={onCancel} />,
    );
    await tick();
    stdin.write("\x1b");
    await tick();
    expect(onCancel).toHaveBeenCalled();
    unmount();
  });
});
