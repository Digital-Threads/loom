import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  renderJournalFromEvents,
  boardTaskJournal,
  exportEventsSafe,
  bindExternal,
  openTask,
  type TjEvent,
} from "../../../../src/core/plugins/task-journal/adapter.js";

// Pure render — no CLI needed. This is the deletion-proof path: the same render
// runs over a stored snapshot once the worktree is gone.
describe("renderJournalFromEvents (unit)", () => {
  const ev = (over: Partial<TjEvent>): TjEvent => ({
    event_id: Math.random().toString(36).slice(2),
    task_id: "tj-x",
    type: "finding",
    timestamp: "2026-06-18T10:00:00.000Z",
    text: "",
    ...over,
  });

  it("renders the task title and every reasoning section", () => {
    const events: TjEvent[] = [
      ev({ type: "open", text: "My board task", timestamp: "2026-06-18T10:00:00.000Z" }),
      ev({ type: "decision", text: "Chose approach B", timestamp: "2026-06-18T10:01:00.000Z" }),
      ev({ type: "finding", text: "data survives deletion", timestamp: "2026-06-18T10:02:00.000Z" }),
      ev({ type: "rejection", text: "env override does not exist", timestamp: "2026-06-18T10:03:00.000Z" }),
      ev({ type: "evidence", text: "test proves it", timestamp: "2026-06-18T10:04:00.000Z" }),
    ];
    const out = renderJournalFromEvents(events);
    expect(out).toContain("My board task");
    expect(out).toContain("Decisions");
    expect(out).toContain("Chose approach B");
    expect(out).toContain("Findings");
    expect(out).toContain("data survives deletion");
    expect(out).toContain("Rejected");
    expect(out).toContain("env override does not exist");
    expect(out).toContain("Evidence");
    expect(out).toContain("test proves it");
  });

  it("returns empty string when there are no events", () => {
    expect(renderJournalFromEvents([])).toBe("");
  });
});

// Integration: real round-trip through the task-journal CLI. Skips cleanly when
// the CLI is absent so it is never red/flaky.
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
  const dir = mkdtempSync(join(tmpdir(), "loom-tj-render-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  return dir;
}

describe("boardTaskJournal / bindExternal (integration)", () => {
  itIntegration("reads back a project's journal and renders its reasoning", () => {
    const dir = throwawayProject();
    const id = openTask(dir, "Integration board task", "the goal") as string;
    expect(id).toBeTruthy();
    execFileSync("task-journal", ["event", "--type", "decision", "--text", "go with worktree read-through", id], { cwd: dir, encoding: "utf8" });

    const pack = boardTaskJournal(dir);
    expect(pack).toContain("Integration board task");
    expect(pack).toContain("go with worktree read-through");
  });

  itIntegration("binds an external loom ref so the journal resolves by it", () => {
    const dir = throwawayProject();
    const id = openTask(dir, "Bindable task", "g") as string;
    const ok = bindExternal(dir, id, "loom:t-test123");
    expect(ok).toBe(true);

    // pack --external resolves the same task by the ref we just added.
    const resolved = execFileSync("task-journal", ["pack", "--external", "loom:t-test123"], { cwd: dir, encoding: "utf8" });
    expect(resolved).toContain("Bindable task");
  });

  it("exportEventsSafe never throws on a bogus project", () => {
    expect(exportEventsSafe("/nonexistent/path/xyz")).toEqual([]);
  });

  it("bindExternal rejects unsafe refs without spawning", () => {
    expect(bindExternal("/tmp", "tj-x", "--malicious")).toBe(false);
    expect(bindExternal("/tmp", "-bad", "loom:x")).toBe(false);
  });
});
