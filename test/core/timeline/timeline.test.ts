import { describe, it, expect } from "vitest";
import { buildTimeline, DEFAULT_TIMELINE_LIMIT, type TimelineEntry } from "../../../src/core/timeline/timeline.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function ws(partial: Partial<WorkspaceData>): WorkspaceData {
  return {
    subscriptions: [], sessions: [], health: [],
    tokens: [], tokenEvents: [], taskEvents: [], tasks: [], errors: [],
    ...partial,
  } as WorkspaceData;
}

describe("LP10 buildTimeline — нормализация слоёв", () => {
  it("token-pilot: TokenEvent.ts(ms) → entry {ts, source:'token-pilot', type:'tokens'}", () => {
    const out = buildTimeline(ws({ tokenEvents: [{ sessionId: "sess-abcdef12", used: 100, saved: 40, ts: 2000 }] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ts: 2000, source: "token-pilot", type: "tokens" });
    expect(out[0].text).toContain("100");
    expect(out[0].text).toContain("40");
  });
  it("task-journal: TjEvent.timestamp(RFC3339) → entry с ts=Date.parse, source:'task-journal'", () => {
    const out = buildTimeline(ws({ taskEvents: [{ event_id: "e1", task_id: "tj-1", type: "finding", timestamp: "2026-06-06T00:00:01.000Z", text: "нашёл баг" }] }));
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(Date.parse("2026-06-06T00:00:01.000Z"));
    expect(out[0].source).toBe("task-journal");
    expect(out[0].type).toBe("finding");
    expect(out[0].text).toContain("нашёл баг");
  });
  it("aimux: SessionRow.lastUsedAtMs → entry {source:'aimux', type:'session'}", () => {
    const out = buildTimeline(ws({ sessions: [{ sessionId: "sess-aimux01", profile: "work", lastUsedAtMs: 1500 }] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ts: 1500, source: "aimux", type: "session" });
    expect(out[0].text).toContain("work");
  });
  it("merge + сортировка по ts убыв. (новые сверху) поверх трёх слоёв", () => {
    const out = buildTimeline(ws({
      tokenEvents: [{ sessionId: "s1", used: 1, saved: 1, ts: 3000 }],
      taskEvents: [{ event_id: "e", task_id: "t", type: "open", timestamp: new Date(1000).toISOString(), text: "старт" }],
      sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 2000 }],
    }));
    expect(out.map((e) => e.ts)).toEqual([3000, 2000, 1000]);
    expect(out.map((e) => e.source)).toEqual(["token-pilot", "aimux", "task-journal"]);
  });
  it("пустой WorkspaceData → []", () => { expect(buildTimeline(ws({}))).toEqual([]); });
  it("сессия без lastUsedAtMs → не попадает в ленту", () => {
    expect(buildTimeline(ws({ sessions: [{ sessionId: "s", profile: "p" }] }))).toEqual([]);
  });
  it("TjEvent с непарсимым timestamp → пропускается", () => {
    expect(buildTimeline(ws({ taskEvents: [{ event_id: "e", task_id: "t", type: "finding", timestamp: "не-дата", text: "x" }] }))).toEqual([]);
  });
  it("tsAccuracy: token-pilot/aimux → 'exact', task-journal живые → 'ingest'", () => {
    const out = buildTimeline(ws({
      tokenEvents: [{ sessionId: "s1", used: 1, saved: 1, ts: 3000 }],
      sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 2000 }],
      taskEvents: [{ event_id: "e", task_id: "t", type: "finding", timestamp: new Date(1000).toISOString(), text: "x" }],
    }));
    const bySource = Object.fromEntries(out.map((e) => [e.source, e.tsAccuracy]));
    expect(bySource["token-pilot"]).toBe("exact");
    expect(bySource["aimux"]).toBe("exact");
    expect(bySource["task-journal"]).toBe("ingest");
  });
  it("дефолтное окно: обрезает до DEFAULT_TIMELINE_LIMIT, новые сверху", () => {
    const many = Array.from({ length: DEFAULT_TIMELINE_LIMIT + 50 }, (_, i) => ({ sessionId: `s${i}`, used: 0, saved: 0, ts: i + 1 }));
    const out = buildTimeline(ws({ tokenEvents: many }));
    expect(out).toHaveLength(DEFAULT_TIMELINE_LIMIT);
    expect(out[0].ts).toBe(DEFAULT_TIMELINE_LIMIT + 50);
  });
  it("opts.limit перекрывает дефолт; Infinity → без обрезки", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ sessionId: `s${i}`, used: 0, saved: 0, ts: i + 1 }));
    expect(buildTimeline(ws({ tokenEvents: many }), { limit: 3 })).toHaveLength(3);
    expect(buildTimeline(ws({ tokenEvents: many }), { limit: Infinity })).toHaveLength(10);
  });
  it("стабильный tie-break при равном ts", () => {
    const mk = () => buildTimeline(ws({
      tokenEvents: [{ sessionId: "s1", used: 0, saved: 0, ts: 5000 }],
      sessions: [{ sessionId: "s2", profile: "p", lastUsedAtMs: 5000 }],
    }));
    const out = mk();
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.ts)).toEqual([5000, 5000]);
    expect(mk().map((e) => e.source)).toEqual(out.map((e) => e.source));
  });
});
