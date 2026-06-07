import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loomRegistry, loadDynamicPlugins } from "../../../src/core/plugins/index.js";

// Уникальный id, чтобы не пересекаться с другими прогонами/реестром.
const DISABLED_ID = "fake-disabled-11-1";

function writePlugin(root: string, id: string, version: string): void {
  const installDir = join(root, id, version);
  mkdirSync(installDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    type: "loom-plugin",
    name: id,
    title: id,
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "./plugin.js",
    provides: { tabs: [{ id: "x", title: "X" }] },
  };
  writeFileSync(join(installDir, "plugin.json"), JSON.stringify(manifest), "utf8");
  writeFileSync(
    join(installDir, "plugin.js"),
    `export const plugin = { id: ${JSON.stringify(id)}, title: "Dyn", tabs: [{ id: "x", title: "X" }], load: () => ({}) };`,
    "utf8",
  );
}

describe("loadDynamicPlugins — фильтр enabled===false", () => {
  let xdg: string;
  let pluginsDir: string;
  const prevXdg = process.env.XDG_DATA_HOME;

  beforeEach(() => {
    xdg = mkdtempSync(join(tmpdir(), "loom-xdg-"));
    // defaultDeps() читает plugins.json из $XDG_DATA_HOME/loom.
    process.env.XDG_DATA_HOME = xdg;
    pluginsDir = join(xdg, "loom", "plugins");
    mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(xdg, { recursive: true, force: true });
  });

  it("плагин с enabled:false в реестре пропускается (не регистрируется)", async () => {
    writePlugin(pluginsDir, DISABLED_ID, "0.0.1");

    // Реестр с этим плагином выключенным.
    const registry = {
      schemaVersion: 1,
      plugins: {
        [DISABLED_ID]: {
          version: "0.0.1",
          installPath: join(pluginsDir, DISABLED_ID, "0.0.1"),
          enabled: false,
          source: "local",
        },
      },
    };
    writeFileSync(join(xdg, "loom", "plugins.json"), JSON.stringify(registry), "utf8");

    const errs = await loadDynamicPlugins(pluginsDir);
    expect(errs).toEqual([]);
    expect(loomRegistry.get(DISABLED_ID)).toBeUndefined();
  });
});
