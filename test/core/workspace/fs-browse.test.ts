import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { browseDir } from "../../../src/core/workspace/fs-browse.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

describe("browseDir", () => {
  it("lists sub-directories, flags git repos, hides noise, and exposes the parent", () => {
    const base = mkdtempSync(join(tmpdir(), "loom-fs-"));
    cleanups.push(() => rmSync(base, { recursive: true, force: true }));
    mkdirSync(join(base, "plain"));
    mkdirSync(join(base, "repo", ".git"), { recursive: true });
    mkdirSync(join(base, "node_modules"));
    mkdirSync(join(base, ".hidden"));
    writeFileSync(join(base, "file.txt"), "x");

    const res = browseDir(base);
    expect(res.path).toBe(base);
    expect(res.parent).toBe(dirname(base));
    expect(res.entries.map((e) => e.name)).toEqual(["plain", "repo"]); // no node_modules/.hidden/file
    expect(res.entries.find((e) => e.name === "repo")?.isGitRepo).toBe(true);
    expect(res.entries.find((e) => e.name === "plain")?.isGitRepo).toBe(false);
  });

  it("returns empty entries for an unreadable path without throwing", () => {
    const res = browseDir(join(tmpdir(), "loom-does-not-exist-xyz"));
    expect(res.entries).toEqual([]);
  });
});
