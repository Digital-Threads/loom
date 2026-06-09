import { describe, it, expect } from "vitest";
import { timelineRows, derivations } from "../../../src/core/views/derivations.js";
import { allDerivations } from "../../../src/core/views/all-derivations.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function ws(partial: Partial<WorkspaceData>): WorkspaceData {
  return { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [], taskEvents: [], tasks: [], errors: [], ...partial } as WorkspaceData;
}

describe("LP10 timelineRows", () => {
  it("a row carries key, when, source, type, text", () => {
    const rows = timelineRows(ws({ tokenEvents: [{ sessionId: "sess-aaaa1111", used: 5, saved: 2, ts: 1717632000000, agentType: null }] }));
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(typeof r.key).toBe("string");
    expect(typeof r.when).toBe("string");
    expect(r.source).toBe("token-pilot");
    expect(r.type).toBe("tokens");
    expect(r.text).toContain("spent 5");
  });
  it("order = buildTimeline (newest first)", () => {
    const rows = timelineRows(ws({ tokenEvents: [{ sessionId: "s", used: 0, saved: 0, ts: 3000, agentType: null }], sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 1000 }] }));
    expect(rows.map((r) => r.source)).toEqual(["token-pilot", "aimux"]);
  });
  it("empty → []", () => { expect(timelineRows(ws({}))).toEqual([]); });
  it("keys are unique when ts is equal", () => {
    const rows = timelineRows(ws({ tokenEvents: [{ sessionId: "s1", used: 0, saved: 0, ts: 5000, agentType: null }], sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 5000 }] }));
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("registered in derivations and allDerivations()", () => {
    expect(derivations.timelineRows).toBe(timelineRows);
    expect(typeof allDerivations().timelineRows).toBe("function");
  });
});
