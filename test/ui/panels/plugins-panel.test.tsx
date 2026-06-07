import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { PluginsPanel } from "../../../src/ui/panels/PluginsPanel.js";

// PluginsPanel читает реестр через readInstalled(defaultDeps()) →
// defaultDeps() берёт dataDir = $XDG_DATA_HOME/loom. Изолируем через временный XDG.

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

  it("пустой реестр → заглушка 'Плагинов нет'", () => {
    const { lastFrame } = render(<PluginsPanel />);
    const f = lastFrame()!;
    expect(f).toContain("Плагинов нет");
  });

  it("непустой реестр → строки с именем, версией и состоянием", () => {
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
    expect(f).toContain("[вкл]");
    expect(f).toContain("off-plugin");
    expect(f).toContain("[выкл]");
    // футер списка
    expect(f).toContain("e вкл/выкл");
  });
});
