import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openTask,
  closeTask,
  loadTaskEvents,
  tasksFromEvents,
} from "@digital-threads/loom-plugin-task-journal";

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

function throwawayProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "loom-tj-actions-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  return dir;
}

describe("task-journal actions — openTask (integration)", () => {
  itIntegration("creates a task and returns a non-empty id readable back", () => {
    const dir = throwawayProject();
    const id = openTask(dir, "Test action task", "mygoal");
    expect(id).toBeTruthy();

    const tasks = tasksFromEvents(loadTaskEvents(dir));
    const found = tasks.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.title).toBe("Test action task");
  });
});

describe("task-journal actions — closeTask (integration)", () => {
  itIntegration("closes a task and the status becomes closed", () => {
    const dir = throwawayProject();
    const id = openTask(dir, "Closeable task", "goal");
    expect(id).toBeTruthy();

    const ok = closeTask(dir, id as string, { outcomeTag: "done", outcome: "ok" });
    expect(ok).toBe(true);

    const tasks = tasksFromEvents(loadTaskEvents(dir));
    const found = tasks.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.status).toBe("closed");
  });
});
