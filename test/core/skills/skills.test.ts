import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, readSkill, writeSkill, generateSkill, deleteSkill } from "../../../src/core/skills/skills.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loom-skills-"));
  // dir-based skill with full frontmatter
  mkdirSync(join(root, "adversarial-review"));
  writeFileSync(join(root, "adversarial-review", "SKILL.md"), "---\nname: adversarial-review\ndescription: Adversarial review.\nuser_invocable: true\n---\n# Body\n");
  // bare .md skill (name from filename, no frontmatter name)
  writeFileSync(join(root, "quick-fix.md"), "---\ndescription: Quick fix helper.\n---\n# Quick\n");
  // a non-skill dir (no SKILL.md) — ignored
  mkdirSync(join(root, "not-a-skill"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("skills library", () => {
  it("lists dir-based and bare-.md skills, skipping non-skill dirs", () => {
    const skills = listSkills(root);
    expect(skills.map((s) => s.name)).toEqual(["adversarial-review", "quick-fix"]);
    const adv = skills.find((s) => s.name === "adversarial-review")!;
    expect(adv.kind).toBe("dir");
    expect(adv.userInvocable).toBe(true);
    expect(adv.description).toBe("Adversarial review.");
    const qf = skills.find((s) => s.name === "quick-fix")!;
    expect(qf.kind).toBe("file"); // name from the filename
    expect(qf.userInvocable).toBe(false);
  });

  it("reads a skill (dir + bare); rejects path traversal", () => {
    expect(readSkill("adversarial-review", root)).toContain("# Body");
    expect(readSkill("quick-fix", root)).toContain("# Quick");
    expect(readSkill("../../etc/passwd", root)).toBeNull();
    expect(readSkill("nope", root)).toBeNull();
  });

  it("writes a new skill as a dir-based SKILL.md", () => {
    expect(writeSkill("my-skill", "---\nname: my-skill\n---\nhi", root)).toBe(true);
    expect(readFileSync(join(root, "my-skill", "SKILL.md"), "utf8")).toContain("hi");
    expect(writeSkill("../evil", "x", root)).toBe(false); // bad name rejected
  });

  it("edits an existing skill in place", () => {
    writeSkill("quick-fix", "---\ndescription: edited.\n---\n# Edited", root);
    expect(readSkill("quick-fix", root)).toContain("# Edited");
  });

  it("AI-generates a skill: extracts name from frontmatter + saves", async () => {
    const agent = async () => "```markdown\n---\nname: gen-skill\ndescription: Generated.\nuser_invocable: true\n---\n# Generated\n```";
    const r = await generateSkill("do a thing", agent, root);
    expect(r?.name).toBe("gen-skill");
    expect(listSkills(root).some((s) => s.name === "gen-skill")).toBe(true);
    expect(readSkill("gen-skill", root)).toContain("# Generated");
    expect(readSkill("gen-skill", root)).not.toContain("```"); // fence stripped
  });

  it("AI-generate returns null when the output has no valid name", async () => {
    const agent = async () => "no frontmatter here";
    expect(await generateSkill("x", agent, root)).toBeNull();
  });

  it("deletes a dir-based skill (removes the whole folder)", () => {
    expect(deleteSkill("adversarial-review", root)).toBe(true);
    expect(existsSync(join(root, "adversarial-review"))).toBe(false);
    expect(listSkills(root).some((s) => s.name === "adversarial-review")).toBe(false);
  });

  it("deletes a bare .md skill", () => {
    expect(deleteSkill("quick-fix", root)).toBe(true);
    expect(existsSync(join(root, "quick-fix.md"))).toBe(false);
    expect(listSkills(root).some((s) => s.name === "quick-fix")).toBe(false);
  });

  it("returns false for a missing skill", () => {
    expect(deleteSkill("nope", root)).toBe(false);
  });

  it("rejects path traversal and leaves files untouched", () => {
    expect(deleteSkill("../../etc/passwd", root)).toBe(false);
    expect(deleteSkill("../evil", root)).toBe(false);
    // the seeded skills are still there
    expect(existsSync(join(root, "adversarial-review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "quick-fix.md"))).toBe(true);
  });

  it("refuses '.' so it can never wipe the skills root", () => {
    // a SKILL.md sitting directly in the root would make '.' resolve to the root
    writeFileSync(join(root, "SKILL.md"), "---\ndescription: root.\n---\n# Root");
    expect(deleteSkill(".", root)).toBe(false);
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, "adversarial-review", "SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "quick-fix.md"))).toBe(true);
  });
});
