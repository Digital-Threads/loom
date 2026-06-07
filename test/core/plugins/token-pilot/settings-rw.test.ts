import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSettings,
  settingValue,
  writeSettings,
} from "../../../../src/core/plugins/token-pilot/adapter.js";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("token-pilot settings read/write", () => {
  it("readSettings returns {} when file is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-tp-rw-"));
    expect(readSettings(dir)).toEqual({});
  });

  it("round-trips and preserves other keys (deep merge, no replace)", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-tp-rw-"));
    writeFileSync(
      join(dir, ".token-pilot.json"),
      JSON.stringify({ ignore: ["a"], hooks: { mode: "advisory", denyThreshold: 300 } }),
      "utf8",
    );

    const ok = writeSettings(dir, {
      "hooks.mode": "off",
      "hooks.denyThreshold": 500,
      "sessionStart.enabled": true,
    });
    expect(ok).toBe(true);

    const result = readSettings(dir);
    expect((result.hooks as Record<string, unknown>).mode).toBe("off");
    expect((result.hooks as Record<string, unknown>).denyThreshold).toBe(500);
    expect((result.sessionStart as Record<string, unknown>).enabled).toBe(true);
    // other keys preserved
    expect(result.ignore).toEqual(["a"]);
    // hooks merged, not replaced (still an object with both keys)
    expect(typeof result.hooks).toBe("object");
    expect(Array.isArray(result.hooks)).toBe(false);
  });

  it("settingValue reads dotted paths and returns undefined for missing", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-tp-rw-"));
    writeSettings(dir, { "hooks.mode": "off" });
    expect(settingValue(dir, "hooks.mode")).toBe("off");
    expect(settingValue(dir, "nope.missing")).toBeUndefined();
  });

  it("writeSettings creates the file when it does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "loom-tp-rw-"));
    const ok = writeSettings(dir, { "cache.maxSizeMB": 42 });
    expect(ok).toBe(true);
    expect(settingValue(dir, "cache.maxSizeMB")).toBe(42);
  });
});
