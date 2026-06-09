import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogPanel } from "../../../src/ui/panels/CatalogPanel.js";
import { InputModeContext } from "../../../src/ui/input/InputModeContext.js";
import type { InstallDeps } from "../../../src/core/install/types.js";

// Fake runner: executes nothing (avoids the known spawn flake),
// install always fails → a deterministic error status.
function makeDeps(): InstallDeps {
  return {
    dataDir: mkdtempSync(join(tmpdir(), "loom-cat-search-")),
    run: () => ({ ok: false, stdout: "", stderr: "" }),
  };
}

// TextInput reads InputModeContext — we wrap the renders in a provider.
function renderPanel(deps: InstallDeps) {
  return render(
    <InputModeContext.Provider value={{ capturing: false, setCapturing: () => {} }}>
      <CatalogPanel deps={deps} />
    </InputModeContext.Provider>,
  );
}

// Poll lastFrame instead of fixed sleeps: ink flushes asynchronously.
async function waitFor(get: () => string, pred: (f: string) => boolean, tries = 50): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const f = get();
    if (pred(f)) return f;
    await new Promise((r) => setTimeout(r, 5));
  }
  return get();
}

describe("CatalogPanel search (loom-4co)", () => {
  it("/ + typing filters the list live", async () => {
    const { lastFrame, stdin } = renderPanel(makeDeps());
    stdin.write("/");
    await Promise.resolve();
    stdin.write("token");
    const f = await waitFor(
      () => lastFrame()!,
      (x) => x.includes("Token Pilot") && !x.includes("Task Journal"),
    );
    expect(f).toContain("Token Pilot");
    expect(f).not.toContain("Task Journal");
    expect(f).not.toContain("aimux");
  });

  it("Esc restores the full list", async () => {
    const { lastFrame, stdin } = renderPanel(makeDeps());
    stdin.write("/");
    await Promise.resolve();
    stdin.write("token");
    await waitFor(
      () => lastFrame()!,
      (x) => x.includes("Token Pilot") && !x.includes("Task Journal"),
    );
    stdin.write("\x1b"); // Esc
    const f = await waitFor(
      () => lastFrame()!,
      (x) => x.includes("Task Journal"),
    );
    expect(f).toContain("Task Journal");
  });
});

describe("CatalogPanel free-form source install (loom-fru)", () => {
  it("a + source + Enter → returns to the list with an error status", async () => {
    const { lastFrame, stdin } = renderPanel(makeDeps());
    stdin.write("a");
    const opened = await waitFor(
      () => lastFrame()!,
      (x) => x.includes("source:"),
    );
    expect(opened).toContain("source:");
    stdin.write("nonexistent-xyz");
    await Promise.resolve();
    stdin.write("\r"); // Enter
    const f = await waitFor(
      () => lastFrame()!,
      (x) => !x.includes("source:") && x.includes("Error"),
    );
    expect(f).not.toContain("source:");
    expect(f).toContain("Error");
  });
});
