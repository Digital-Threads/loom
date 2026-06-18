import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relocateSession } from "../../../src/core/automation/session-relocate.js";

describe("relocateSession", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "loom-reloc-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const sess = (dir: string, sub: string, id: string, body = "{}\n") => {
    const d = join(dir, "projects", sub);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, `${id}.jsonl`), body);
  };

  it("copies the session into the target config dir, preserving the project sub-dir", () => {
    const src = join(root, "src-dir");
    const target = join(root, "target-dir");
    sess(src, "-home-wt", "sid1", "line\n");
    expect(relocateSession("sid1", [src, target], target)).toBe(true);
    const dest = join(target, "projects", "-home-wt", "sid1.jsonl");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("line\n");
  });

  it("is a no-op (true) when the session is already under the target", () => {
    const target = join(root, "target-dir");
    sess(target, "-p", "sid2");
    expect(relocateSession("sid2", [join(root, "other"), target], target)).toBe(true);
  });

  it("returns false when the session can't be found anywhere", () => {
    const target = join(root, "target-dir");
    expect(relocateSession("missing", [join(root, "a"), target], target)).toBe(false);
  });
});
