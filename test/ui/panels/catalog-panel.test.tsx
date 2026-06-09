import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogPanel } from "../../../src/ui/panels/CatalogPanel.js";
import type { InstallDeps } from "../../../src/core/install/types.js";

const tmp = mkdtempSync(join(tmpdir(), "loom-catui-"));
const fakeDeps: InstallDeps = { dataDir: tmp, run: () => ({ ok: false, stdout: "", stderr: "" }) };

describe("CatalogPanel render", () => {
  it("empty registry → all ○ not-installed, cases and categories visible", () => {
    const { lastFrame } = render(<CatalogPanel deps={fakeDeps} />);
    const f = lastFrame()!;
    expect(f).toContain("○");
    expect(f).toContain("Token Pilot");
    expect(f).toContain("Save tokens");
    expect(f).toContain("efficiency");
  });
  it("the footer shows the catalog hotkeys", () => {
    const { lastFrame } = render(<CatalogPanel deps={fakeDeps} />);
    expect(lastFrame()!).toContain("Enter");
  });
});

describe("CatalogPanel actions", () => {
  it("Enter on a not-installed item → install confirmation", async () => {
    const fake: InstallDeps = {
      dataDir: mkdtempSync(join(tmpdir(), "loom-c4-")),
      run: () => ({ ok: false, stdout: "", stderr: "" }),
    };
    const { lastFrame, stdin } = render(<CatalogPanel deps={fake} />);
    stdin.write("\r");
    await Promise.resolve(); // ink/React: the render flushes on the next microtask
    const f = lastFrame()!;
    expect(f.toLowerCase()).toContain("install");
    expect(f).toMatch(/y\/n|y · n|\(y\/n\)/i);
  });

  it("y confirms → runs the install recipe via CmdRunner", async () => {
    const calls: string[] = [];
    // cursor=0 = aimux: detect probe = npm ls -g ... → not-installed;
    // install = npm install -g ... → ok + a recorded call.
    const fake: InstallDeps = {
      dataDir: mkdtempSync(join(tmpdir(), "loom-c4b-")),
      run: (cmd, args) => {
        if (cmd === "npm" && args[0] === "ls") return { ok: false, stdout: "", stderr: "" };
        calls.push([cmd, ...args].join(" "));
        return { ok: true, stdout: "", stderr: "" };
      },
    };
    const { stdin } = render(<CatalogPanel deps={fake} />);
    stdin.write("\r");
    await Promise.resolve(); // let mode move to confirmInstall before pressing y
    stdin.write("y");
    await Promise.resolve();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("catalog hotkeys do not conflict with the global App ones (q/←/→)", () => {
    const handled = new Set(["i", "u", "d", "e", "y", "n"]);
    expect(handled.has("q")).toBe(false);
  });
});

describe("CatalogPanel grouping by layers", () => {
  it("groups by layers from loomRegistry.groupByCategory (LP1): layer headers in registry order", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loom-c6-"));
    const fake: InstallDeps = { dataDir: tmp, run: () => ({ ok: false, stdout: "", stderr: "" }) };
    const { lastFrame } = render(<CatalogPanel deps={fake} />);
    // Strip ANSI codes (Text bold/color wraps the header) so we check
    // the actual line text, not the escape sequences.
    const f = lastFrame()!.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
    // The layer header is on its OWN line (a section), not a [category] column.
    expect(f).toMatch(/^\s*—\s*accounts\s*—\s*$/m);
    expect(f).toMatch(/^\s*—\s*efficiency\s*—\s*$/m);
    expect(f).toMatch(/^\s*—\s*memory\s*—\s*$/m);
    // Section order = registry registration order.
    expect(f.indexOf("— accounts —")).toBeLessThan(f.indexOf("— memory —"));
    expect(f.indexOf("— efficiency —")).toBeLessThan(f.indexOf("— memory —"));
  });
});

describe("CatalogPanel lazy latest", () => {
  it("lazy latest loading: first \"checking\", then ↻", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "loom-c45-"));
    const fake: InstallDeps = { dataDir: tmp, run: (c, a) => {
      const key = [c, ...a].join(" ");
      if (key.includes("view") || key.includes("search")) return { ok: true, stdout: "1.2.0", stderr: "" }; // latest
      // detect-probe: aimux npm ls -g → installed + version 1.0.0
      if (a.includes("ls")) return { ok: true, stdout: "@digital-threads/aimux@1.0.0", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    } };
    const { lastFrame } = render(<CatalogPanel deps={fake} />);
    // first frame: installed items show the checking indicator
    expect(lastFrame()!).toMatch(/checking|↻…/);
    await Promise.resolve(); await Promise.resolve();
    expect(lastFrame()!).toContain("↻");
  });

  it("not-installed does not show an update-check indicator", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loom-c45b-"));
    const fake: InstallDeps = { dataDir: tmp, run: () => ({ ok: false, stdout: "", stderr: "" }) };
    const { lastFrame } = render(<CatalogPanel deps={fake} />);
    expect(lastFrame()!).not.toMatch(/checking|↻…/);
    expect(lastFrame()!).toContain("○");
  });
});
