import { describe, it, expect, vi } from "vitest";

// Make every fs write throw, as on a read-only HOME, to exercise the visible
// (non-swallowed) failure path of enforcedSettingsPath(). Kept in its own file
// so the module-level cache/warn flags start fresh (vitest isolates per file).
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(() => { throw new Error("EROFS: read-only file system"); }),
  };
});

describe("enforcedSettingsPath — write failure", () => {
  it("logs once, does not cache, and still returns the path", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fs = await import("node:fs");
    const { enforcedSettingsPath, enforcedSettingsWriteFailed } = await import("../../../src/core/automation/enforced-settings.js");

    expect(enforcedSettingsWriteFailed()).toBe(false); // nothing attempted yet
    const p1 = enforcedSettingsPath();
    const p2 = enforcedSettingsPath();

    expect(p1).toMatch(/enforced-settings\.json$/);
    expect(p2).toBe(p1);
    // the failed write is now visible to a launcher (so it can mark the task)
    expect(enforcedSettingsWriteFailed()).toBe(true);
    // not cached on failure → the write is re-attempted on the second call
    expect((fs.writeFileSync as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThanOrEqual(2);
    // but the error is surfaced only once — no per-call log spam
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });
});
