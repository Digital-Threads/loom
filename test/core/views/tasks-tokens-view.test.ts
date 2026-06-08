import { describe, it, expect } from "vitest";
import { tasksTokensView } from "../../../src/ui/views/host-views.js";

describe("tasksTokensView", () => {
  it("is a table over tasksWithTokensRows with a tokens column", () => {
    expect(tasksTokensView.kind).toBe("table");
    expect((tasksTokensView as any).source).toEqual({ fn: "tasksWithTokensRows" });
    const cols = (tasksTokensView as any).columns.map((c: any) => c.value);
    expect(cols).toContain("tokens");
  });
  it("в колонках есть бейдж точности (badge)", () => {
    const cols = (tasksTokensView as any).columns.map((c: any) => c.value);
    expect(cols).toContain("badge");
  });
  it("opens taskDetail on select (reuses existing detail view)", () => {
    expect((tasksTokensView as any).onSelect).toEqual({ openView: "taskDetail", passId: "id" });
  });
  it("carries a dim estimate note (honest about accuracy)", () => {
    expect(JSON.stringify(tasksTokensView)).toMatch(/оценк|время/i);
  });
  it("warns about overlap (double-count) so number is not read as fact", () => {
    expect(JSON.stringify(tasksTokensView)).toMatch(/перекрыт|наложен/i);
  });
});
