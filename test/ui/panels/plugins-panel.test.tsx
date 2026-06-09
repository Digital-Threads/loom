import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { PluginsPanel } from "../../../src/ui/panels/PluginsPanel.js";

// PluginsPanel reads the registry via readInstalled(defaultDeps()) →
// defaultDeps() takes dataDir = $XDG_DATA_HOME/loom. We isolate it via a temporary XDG.

describe("PluginsPanel render smoke", () => {
  let xdg: string;
  const prevXdg = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    xdg = mkdtempSync(join(tmpdir(), "loom-panel-"));
    process.env.XDG_DATA_HOME = xdg;
    mkdirSync(join(xdg, "loom"), { recursive: true });
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(xdg, { recursive: true, force: true });
  });

  it("empty registry → 'No plugins' placeholder", () => {
    const { lastFrame } = render(<PluginsPanel />);
    const f = lastFrame()!;
    expect(f).toContain("No plugins");
  });

  it("non-empty registry → rows with name, version and state", () => {
    const registry = {
      schemaVersion: 1,
      plugins: {
        "demo-plugin": {
          version: "2.3.4",
          installPath: join(xdg, "loom", "plugins", "demo-plugin", "2.3.4"),
          enabled: true,
          source: "npm demo-plugin",
        },
        "off-plugin": {
          version: "0.1.0",
          installPath: join(xdg, "loom", "plugins", "off-plugin", "0.1.0"),
          enabled: false,
          source: "local ./off",
        },
      },
    };
    writeFileSync(join(xdg, "loom", "plugins.json"), JSON.stringify(registry), "utf8");

    const { lastFrame } = render(<PluginsPanel />);
    const f = lastFrame()!;
    expect(f).toContain("demo-plugin");
    expect(f).toContain("v2.3.4");
    expect(f).toContain("[on]");
    expect(f).toContain("off-plugin");
    expect(f).toContain("[off]");
    // list footer
    expect(f).toContain("e toggle");
  });

  it("the p hotkey calls packAction and shows the path", async () => {
    let called = false;
    const packAction = async () => {
      called = true;
      return "/tmp/workspace-pack.md";
    };
    const { lastFrame, stdin } = render(<PluginsPanel packAction={packAction} />);
    await Promise.resolve();
    stdin.write("p");
    await Promise.resolve();
    await Promise.resolve();
    // let the packAction promise resolve
    await new Promise((r) => setTimeout(r, 20));
    expect(called).toBe(true);
    expect(lastFrame()!).toMatch(/pack written|\/tmp\/workspace-pack\.md/);
  });

  it("the footer mentions p — build pack", () => {
    const { lastFrame } = render(<PluginsPanel packAction={async () => "x"} />);
    expect(lastFrame()!.toLowerCase()).toContain("pack");
  });
});
