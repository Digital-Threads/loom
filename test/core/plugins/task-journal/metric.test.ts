import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  formatTokenMetric,
  parseTokenMetric,
  tokenMetricsFromEvents,
  writeTokenMetric,
  loadTaskEvents,
  type TaskTokens,
  type TjEvent,
} from "@digital-threads/loom-plugin-task-journal";

function ev(partial: Partial<TjEvent> & Pick<TjEvent, "task_id" | "type" | "timestamp">): TjEvent {
  return {
    event_id: partial.event_id ?? `e-${partial.task_id}-${partial.type}-${partial.timestamp}`,
    task_id: partial.task_id,
    type: partial.type,
    timestamp: partial.timestamp,
    text: partial.text ?? "",
    meta: partial.meta,
  };
}

describe("token metric — format/parse round-trip", () => {
  it("round-trips used/saved", () => {
    const t: TaskTokens = { used: 1234, saved: 56 };
    expect(parseTokenMetric(formatTokenMetric(t))).toEqual(t);
  });

  it("round-trips 0/0", () => {
    const t: TaskTokens = { used: 0, saved: 0 };
    expect(parseTokenMetric(formatTokenMetric(t))).toEqual(t);
  });

  it("round-trips large numbers", () => {
    const t: TaskTokens = { used: 9_876_543_210, saved: 1_000_000_000 };
    expect(parseTokenMetric(formatTokenMetric(t))).toEqual(t);
  });

  it("formats with the marker prefix and compact JSON", () => {
    expect(formatTokenMetric({ used: 1, saved: 2 })).toBe('loom-tokens: {"used":1,"saved":2}');
  });
});

describe("token metric — parse rejects bad input", () => {
  it("returns null for plain text without marker", () => {
    expect(parseTokenMetric("just a regular evidence note")).toBeNull();
  });

  it("returns null for marker followed by invalid JSON", () => {
    expect(parseTokenMetric("loom-tokens: {not json}")).toBeNull();
  });

  it("returns null for JSON missing used", () => {
    expect(parseTokenMetric('loom-tokens: {"saved":5}')).toBeNull();
  });

  it("returns null for JSON with non-number saved", () => {
    expect(parseTokenMetric('loom-tokens: {"used":5,"saved":"nope"}')).toBeNull();
  });

  it("returns null for NaN/Infinity fields", () => {
    expect(parseTokenMetric('loom-tokens: {"used":5,"saved":null}')).toBeNull();
  });

  it("tolerates leading whitespace before the marker", () => {
    expect(parseTokenMetric('   \n loom-tokens: {"used":7,"saved":8}')).toEqual({ used: 7, saved: 8 });
  });
});

describe("token metric — tokenMetricsFromEvents", () => {
  const events: TjEvent[] = [
    // evidence WITH marker for task X (second chronologically)
    ev({ task_id: "X", type: "evidence", timestamp: "2026-06-07T09:05:00.000Z", text: formatTokenMetric({ used: 200, saved: 20 }) }),
    // evidence WITH marker for task X (first chronologically)
    ev({ task_id: "X", type: "evidence", timestamp: "2026-06-07T09:01:00.000Z", text: formatTokenMetric({ used: 100, saved: 10 }) }),
    // evidence WITHOUT marker for task X
    ev({ task_id: "X", type: "evidence", timestamp: "2026-06-07T09:03:00.000Z", text: "ran tests, all green" }),
    // decision event with marker-looking text for task X (must be excluded)
    ev({ task_id: "X", type: "decision", timestamp: "2026-06-07T09:02:00.000Z", text: formatTokenMetric({ used: 999, saved: 99 }) }),
    // evidence WITH marker for a DIFFERENT task
    ev({ task_id: "Y", type: "evidence", timestamp: "2026-06-07T09:04:00.000Z", text: formatTokenMetric({ used: 500, saved: 50 }) }),
  ];

  it("returns only marker evidence of task X, chronologically", () => {
    expect(tokenMetricsFromEvents(events, "X")).toEqual([
      { used: 100, saved: 10 },
      { used: 200, saved: 20 },
    ]);
  });

  it("excludes a non-evidence event even when its text has the marker", () => {
    const result = tokenMetricsFromEvents(events, "X");
    expect(result).not.toContainEqual({ used: 999, saved: 99 });
  });

  it("returns empty for a task with no metrics", () => {
    expect(tokenMetricsFromEvents(events, "Z")).toEqual([]);
  });
});

// Integration: real round-trip through the task-journal CLI in a throwaway git dir.
// Guarded so it skips cleanly if the CLI is unavailable — never red/flaky.
function tjAvailable(): boolean {
  try {
    execFileSync("task-journal", ["--version"], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

const itIntegration = tjAvailable() ? it : it.skip;

describe("token metric — CLI round-trip (integration)", () => {
  itIntegration("writes a metric and reads it back via loadTaskEvents", () => {
    const projDir = mkdtempSync(join("/home/shahinyanm/.claude/jobs/0e9a1b59/tmp", "loom-itest-"));
    execFileSync("git", ["init", "-q"], { cwd: projDir, encoding: "utf8" });

    const taskId = execFileSync(
      "task-journal",
      ["create", "loom phase4 itest", "--goal", "verify writeTokenMetric round-trip"],
      { cwd: projDir, encoding: "utf8" },
    ).trim();

    const ok = writeTokenMetric(projDir, taskId, { used: 1234, saved: 56 });
    expect(ok).toBe(true);

    const events = loadTaskEvents(projDir);
    const metrics = tokenMetricsFromEvents(events, taskId);
    expect(metrics).toContainEqual({ used: 1234, saved: 56 });
  });
});
