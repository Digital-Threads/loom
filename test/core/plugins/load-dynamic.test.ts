import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loomRegistry,
  loadDynamicPlugins,
} from "../../../src/core/plugins/index.js";

// Уникальный id чтобы не загрязнять глобальный реестр между прогонами.
const FAKE_ID = "fake-dyn-8-3";

function writeManifestAndEntry(
  root: string,
  name: string,
  version: string,
  opts: { manifestName?: string; pluginId?: string; apiVersion?: string },
): void {
  const installDir = join(root, name, version);
  mkdirSync(installDir, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    type: "loom-plugin",
    name: opts.manifestName ?? name,
    title: name,
    version: "1.0.0",
    apiVersion: opts.apiVersion ?? "1.0",
    entry: "./plugin.js",
    provides: { tabs: [{ id: "x", title: "X" }] },
  };
  writeFileSync(join(installDir, "plugin.json"), JSON.stringify(manifest), "utf8");

  const pluginId = opts.pluginId ?? opts.manifestName ?? name;
  writeFileSync(
    join(installDir, "plugin.js"),
    `export const plugin = { id: ${JSON.stringify(pluginId)}, title: "Dyn", tabs: [{ id: "x", title: "X" }], load: () => ({}) };`,
    "utf8",
  );
}

describe("loadDynamicPlugins", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loom-dyn-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("грузит плагин с диска в loomRegistry", async () => {
    writeManifestAndEntry(dir, FAKE_ID, "0.0.1", {});
    const errs = await loadDynamicPlugins(dir);
    expect(errs).toEqual([]);
    expect(loomRegistry.get(FAKE_ID)?.title).toBe("Dyn");
  });

  it("дубль builtin id (aimux) не перезаписывается, отмечается в ошибках", async () => {
    const builtinTitle = loomRegistry.get("aimux")?.title;
    expect(builtinTitle).toBeDefined();

    writeManifestAndEntry(dir, "aimux", "9.9.9", {});
    const errs = await loadDynamicPlugins(dir);

    // aimux остался builtin (title не изменился)
    expect(loomRegistry.get("aimux")?.title).toBe(builtinTitle);
    expect(errs.some((e) => e.includes("aimux"))).toBe(true);
  });

  it("несуществующий каталог → пустой список ошибок, не бросает", async () => {
    const errs = await loadDynamicPlugins(join(dir, "nope"));
    expect(errs).toEqual([]);
  });

  it("3 builtin всё ещё в реестре", () => {
    expect(loomRegistry.get("aimux")).toBeDefined();
    expect(loomRegistry.get("token-pilot")).toBeDefined();
    expect(loomRegistry.get("task-journal")).toBeDefined();
  });
});
