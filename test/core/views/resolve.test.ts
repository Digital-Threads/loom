import { describe, it, expect } from "vitest";
import { getDotted, resolveFieldRef, resolveBind, type BindContext } from "../../../src/core/views/resolve.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function makeData(over: Partial<WorkspaceData> = {}): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    ...over,
  } as WorkspaceData;
}

describe("getDotted", () => {
  it("reads nested dotted path", () => {
    expect(getDotted({ a: { b: { c: 7 } } }, "a.b.c")).toBe(7);
  });

  it("returns undefined for missing path", () => {
    expect(getDotted({ a: 1 }, "a.b.c")).toBeUndefined();
  });

  it("supports .length on arrays", () => {
    expect(getDotted({ xs: [1, 2, 3] }, "xs.length")).toBe(3);
  });

  it("supports .length on strings", () => {
    expect(getDotted({ s: "abcd" }, "s.length")).toBe(4);
  });
});

describe("resolveFieldRef", () => {
  it("resolves path against data by default", () => {
    const ctx: BindContext = { data: makeData({ tasks: [{ id: "t1", title: "x", status: "open" }] }) };
    expect(resolveFieldRef("tasks.length", ctx)).toBe(1);
  });

  it("prefers row when first segment present in row", () => {
    const ctx: BindContext = {
      data: makeData({ tasks: [{ id: "fromData", title: "d", status: "open" }] }),
      row: { id: "fromRow", title: "r" },
    };
    expect(resolveFieldRef("id", ctx)).toBe("fromRow");
  });

  it("falls back to data when first segment absent in row", () => {
    const ctx: BindContext = {
      data: makeData({ tasks: [{ id: "x", title: "t", status: "open" }] }),
      row: { other: 1 },
    };
    expect(resolveFieldRef("tasks.length", ctx)).toBe(1);
  });

  it("maps idParam / taskId context keys to ctx.idParam", () => {
    const ctx: BindContext = { data: makeData(), idParam: "tj-42" };
    expect(resolveFieldRef("idParam", ctx)).toBe("tj-42");
    expect(resolveFieldRef("taskId", ctx)).toBe("tj-42");
  });
});

describe("resolveBind", () => {
  it("resolves a FieldRef string", () => {
    const ctx: BindContext = { data: makeData({ subscriptions: [{ name: "a", cli: "c", isSource: true }] }) };
    expect(resolveBind("subscriptions.length", ctx)).toBe(1);
  });

  it("calls a derivation by {fn}", () => {
    const data = makeData({
      sessions: [{ sessionId: "s1", profile: "p1" }],
      tokens: [{ sessionId: "s1", used: 10, saved: 2 }],
    });
    const ctx: BindContext = { data };
    const result = resolveBind({ fn: "sessionsWithTokens" }, ctx) as unknown[];
    expect(result).toEqual([{ sessionId: "s1", profile: "p1", used: 10, saved: 2 }]);
  });

  it("passes idParam through fn args (string arg 'taskId' → ctx.idParam)", () => {
    const data = makeData({ tasks: [{ id: "tj-1", title: "Title One", status: "open" }] });
    const ctx: BindContext = { data, idParam: "tj-1" };
    expect(resolveBind({ fn: "taskTitle", args: ["taskId"] }, ctx)).toBe("Title One");
  });

  it("treats non-context string args as literals", () => {
    const data = makeData({ tasks: [{ id: "tj-9", title: "Nine", status: "open" }] });
    const ctx: BindContext = { data, idParam: "ignored" };
    expect(resolveBind({ fn: "taskTitle", args: ["tj-9"] }, ctx)).toBe("Nine");
  });

  it("returns undefined for unknown fn (defensive, no throw)", () => {
    const ctx: BindContext = { data: makeData() };
    expect(resolveBind({ fn: "doesNotExist" }, ctx)).toBeUndefined();
  });
});
