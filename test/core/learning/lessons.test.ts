import { describe, it, expect } from "vitest";
import { lessonSignature, correctionSignature, computeLessons } from "../../../src/core/learning/lessons.js";

describe("learning/lessons (L8 Slice 0)", () => {
  it("lessonSignature is stable on severity + file, case-insensitive", () => {
    expect(lessonSignature({ severity: "Error", file: "a.ts" })).toBe("error::a.ts");
    expect(lessonSignature({ severity: "error", file: "a.ts" })).toBe("error::a.ts");
    expect(lessonSignature({ severity: "warn" })).toBe("warn::*");
  });

  it("correctionSignature keys on file, else a coarse message bucket", () => {
    expect(correctionSignature({ file: "x.ts", message: "anything" })).toBe("correction::x.ts");
    // coarse bucket = first 6 normalized tokens (so near-identical corrections merge)
    expect(correctionSignature({ message: "Use the repository pattern here please and elsewhere" })).toBe(
      "correction::use the repository pattern here please",
    );
  });

  it("keeps a finding only once it recurs across >= minRuns DISTINCT tasks", () => {
    const findings = [
      { taskId: "t1", severity: "error", message: "null deref", file: "a.ts" },
      { taskId: "t2", severity: "error", message: "null deref again", file: "a.ts" },
      { taskId: "t3", severity: "warn", message: "one-off", file: "b.ts" },
    ];
    const lessons = computeLessons(findings, [], { minRuns: 2 });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ kind: "finding", file: "a.ts", severity: "error", occurrences: 2 });
    expect(lessons[0].taskIds.sort()).toEqual(["t1", "t2"]);
  });

  it("counts DISTINCT tasks, not raw count — same task twice does not cross the threshold", () => {
    const findings = [
      { taskId: "t1", severity: "error", message: "a", file: "a.ts" },
      { taskId: "t1", severity: "error", message: "b", file: "a.ts" },
    ];
    expect(computeLessons(findings, [], { minRuns: 2 })).toHaveLength(0);
  });

  it("a single user correction is already a lesson (no recurrence threshold)", () => {
    const lessons = computeLessons([], [{ taskId: "t1", message: "use async here", file: "a.ts" }], { minRuns: 2 });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ kind: "correction", file: "a.ts", occurrences: 1 });
  });

  it("ranks corrections above findings, then by occurrences", () => {
    const findings = [
      { taskId: "t1", severity: "error", message: "x", file: "a.ts" },
      { taskId: "t2", severity: "error", message: "x", file: "a.ts" },
      { taskId: "t3", severity: "error", message: "x", file: "a.ts" },
      { taskId: "t1", severity: "warn", message: "y", file: "b.ts" },
      { taskId: "t2", severity: "warn", message: "y", file: "b.ts" },
    ];
    const corrections = [{ taskId: "t9", message: "do it this way", file: "z.ts" }];
    const lessons = computeLessons(findings, corrections, { minRuns: 2 });
    expect(lessons.map((l) => l.kind)).toEqual(["correction", "finding", "finding"]);
    // among findings, the 3-task one (a.ts) ranks before the 2-task one (b.ts)
    expect(lessons[1].file).toBe("a.ts");
    expect(lessons[2].file).toBe("b.ts");
  });

  it("dedupes and caps sample messages; tracks first/last seen", () => {
    const findings = [
      { taskId: "t1", severity: "error", message: "dup", file: "a.ts", ts: 100 },
      { taskId: "t2", severity: "error", message: "dup", file: "a.ts", ts: 300 },
      { taskId: "t3", severity: "error", message: "other", file: "a.ts", ts: 200 },
    ];
    const [lesson] = computeLessons(findings, [], { minRuns: 2, maxSamples: 1 });
    expect(lesson.sampleMessages).toEqual(["dup"]); // deduped + capped at 1
    expect(lesson.firstSeen).toBe(100);
    expect(lesson.lastSeen).toBe(300);
  });

  it("is pure: same input → same output (caller does project scoping)", () => {
    const findings = [
      { taskId: "t1", severity: "error", message: "m", file: "a.ts" },
      { taskId: "t2", severity: "error", message: "m", file: "a.ts" },
    ];
    expect(computeLessons(findings)).toEqual(computeLessons(findings));
  });
});
