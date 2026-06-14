import { describe, it, expect } from "vitest";
import { runMigrations, type Migration } from "../../../src/core/store/migrations.js";

describe("runMigrations (D3.3)", () => {
  it("applies migrations in (from, to] order, returns the version reached", () => {
    const order: number[] = [];
    const migs: Record<number, Migration> = {
      2: () => order.push(2),
      3: () => order.push(3),
      4: () => order.push(4),
    };
    // db unused by these fakes
    const reached = runMigrations({} as never, 1, 3, migs);
    expect(order).toEqual([2, 3]); // 4 not applied (beyond `to`)
    expect(reached).toBe(3);
  });

  it("no-op when already current", () => {
    const order: number[] = [];
    const reached = runMigrations({} as never, 3, 3, { 2: () => order.push(2) });
    expect(order).toEqual([]);
    expect(reached).toBe(3);
  });

  it("skips missing migrations (covered by IF NOT EXISTS DDL)", () => {
    const order: number[] = [];
    const reached = runMigrations({} as never, 1, 3, { 3: () => order.push(3) });
    expect(order).toEqual([3]); // 2 absent → skipped
    expect(reached).toBe(3);
  });
});
