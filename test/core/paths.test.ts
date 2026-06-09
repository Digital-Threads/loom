import { describe, it, expect, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loomDataDir,
  loomPluginsDir,
  loomRegistryFile,
} from "../../src/core/paths.js";

const ORIG = process.env.XDG_DATA_HOME;

afterEach(() => {
  if (ORIG === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = ORIG;
});

describe("paths", () => {
  it("loomDataDir = $XDG_DATA_HOME/loom when set", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";
    expect(loomDataDir()).toBe(join("/tmp/xdg-data", "loom"));
  });

  it("loomDataDir = ~/.loom when XDG_DATA_HOME is not set", () => {
    delete process.env.XDG_DATA_HOME;
    expect(loomDataDir()).toBe(join(homedir(), ".loom"));
  });

  it("loomPluginsDir = <data>/plugins", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";
    expect(loomPluginsDir()).toBe(join("/tmp/xdg-data", "loom", "plugins"));
  });

  it("loomRegistryFile = <data>/plugins.json", () => {
    process.env.XDG_DATA_HOME = "/tmp/xdg-data";
    expect(loomRegistryFile()).toBe(
      join("/tmp/xdg-data", "loom", "plugins.json"),
    );
  });

  it("without XDG: plugins/registry are placed under ~/.loom", () => {
    delete process.env.XDG_DATA_HOME;
    expect(loomPluginsDir()).toBe(join(homedir(), ".loom", "plugins"));
    expect(loomRegistryFile()).toBe(join(homedir(), ".loom", "plugins.json"));
  });
});
