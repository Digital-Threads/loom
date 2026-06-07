import { describe, it, expect } from "vitest";
import { timelineRows, derivations } from "../../../src/core/views/derivations.js";
import { allDerivations } from "../../../src/core/views/all-derivations.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function ws(partial: Partial<WorkspaceData>): WorkspaceData {
  return { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [], taskEvents: [], tasks: [], errors: [], ...partial } as WorkspaceData;
}

describe("LP10 timelineRows", () => {
  it("строка несёт key, when, source, type, text", () => {
    const rows = timelineRows(ws({ tokenEvents: [{ sessionId: "sess-aaaa1111", used: 5, saved: 2, ts: 1717632000000 }] }));
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(typeof r.key).toBe("string");
    expect(typeof r.when).toBe("string");
    expect(r.source).toBe("token-pilot");
    expect(r.type).toBe("tokens");
    expect(r.text).toContain("потрачено 5");
  });
  it("порядок = buildTimeline (новые сверху)", () => {
    const rows = timelineRows(ws({ tokenEvents: [{ sessionId: "s", used: 0, saved: 0, ts: 3000 }], sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 1000 }] }));
    expect(rows.map((r) => r.source)).toEqual(["token-pilot", "aimux"]);
  });
  it("пусто → []", () => { expect(timelineRows(ws({}))).toEqual([]); });
  it("ключи уникальны при равном ts", () => {
    const rows = timelineRows(ws({ tokenEvents: [{ sessionId: "s1", used: 0, saved: 0, ts: 5000 }], sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 5000 }] }));
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("зарегистрирована в derivations и allDerivations()", () => {
    expect(derivations.timelineRows).toBe(timelineRows);
    expect(typeof allDerivations().timelineRows).toBe("function");
  });
});
