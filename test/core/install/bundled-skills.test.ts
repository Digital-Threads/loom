import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBundledSkills, BUNDLED_SKILLS, bundledSkillsDir } from "../../../src/core/install/bundled-skills.js";

let src: string;
let target: string;
beforeEach(() => {
  src = mkdtempSync(join(tmpdir(), "loom-skills-src-"));
  target = mkdtempSync(join(tmpdir(), "loom-skills-tgt-"));
  for (const name of ["adversarial-review", "code-review-format"]) {
    mkdirSync(join(src, name), { recursive: true });
    writeFileSync(join(src, name, "SKILL.md"), `# ${name}`);
  }
});
afterEach(() => {
  rmSync(src, { recursive: true, force: true });
  rmSync(target, { recursive: true, force: true });
});

describe("bundled skills", () => {
  it("ships every named skill as a real package directory with a SKILL.md", () => {
    for (const name of BUNDLED_SKILLS) {
      expect(existsSync(join(bundledSkillsDir(), name, "SKILL.md"))).toBe(true);
    }
  });

  it("copies bundled skills into an empty target; missing ones are skipped, not errored", () => {
    const r = installBundledSkills(target, src);
    expect(r.installed.sort()).toEqual(["adversarial-review", "code-review-format"]);
    expect(readFileSync(join(target, "adversarial-review", "SKILL.md"), "utf8")).toContain("adversarial-review");
    expect(r.skipped).toContain("pr-description-format"); // not in this source → skipped
  });

  it("never clobbers an existing skill of the same name", () => {
    mkdirSync(join(target, "adversarial-review"), { recursive: true });
    writeFileSync(join(target, "adversarial-review", "SKILL.md"), "USER OWN");
    const r = installBundledSkills(target, src);
    expect(r.skipped).toContain("adversarial-review");
    expect(readFileSync(join(target, "adversarial-review", "SKILL.md"), "utf8")).toBe("USER OWN");
    expect(r.installed).toContain("code-review-format");
  });
});
