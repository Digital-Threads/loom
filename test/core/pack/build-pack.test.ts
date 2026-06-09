import { describe, it, expect } from "vitest";
import { buildPack } from "../../../src/core/pack/build-pack.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function emptyData(): WorkspaceData {
  return { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [],
    taskEvents: [], tasks: [], projectId: "", errors: [] } as any;
}

describe("buildPack skeleton", () => {
  it("starts with # Workspace pack and contains Project", () => {
    const md = buildPack({ data: emptyData(), config: { projectName: "demo" } });
    expect(md.startsWith("# Workspace pack")).toBe(true);
    expect(md).toContain("Project: demo");
  });
  it("Project: — when the name is missing", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("Project: —");
  });
  it("ends with a footer note about time-based token estimation", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toMatch(/time-based estimate|double-count/i);
  });
  it("deterministic (one input → one text)", () => {
    const a = buildPack({ data: emptyData(), config: { projectName: "x" } });
    const b = buildPack({ data: emptyData(), config: { projectName: "x" } });
    expect(a).toBe(b);
  });
});

describe("sectionProfile", () => {
  it("explicit profile from config", () => {
    const md = buildPack({ data: emptyData(), config: { activeProfile: "work" } });
    expect(md).toContain("## Active profile\n\nwork");
  });
  it("heuristic: the last session's profile when config is empty", () => {
    const data = { ...emptyData(), sessions: [
      { sessionId: "s1", profile: "old", lastUsedAtMs: 100 },
      { sessionId: "s2", profile: "new", lastUsedAtMs: 200 },
    ] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toMatch(/## Active profile\n\nnew \(heuristic/);
  });
  it("unavailable when there is neither config nor sessions", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("## Active profile\n\n_unavailable");
  });
  it("deterministic tie-break by sessionId when lastUsedAtMs is equal", () => {
    const data = { ...emptyData(), sessions: [
      { sessionId: "b", profile: "pb", lastUsedAtMs: 0 },
      { sessionId: "a", profile: "pa", lastUsedAtMs: 0 },
    ] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toMatch(/## Active profile\n\npa /);  // sessionId "a" < "b"
  });
});

describe("sectionTask", () => {
  const tasks = [{ id: "tj-1", title: "Alpha", status: "open" }, { id: "tj-2", title: "Beta", status: "closed" }];
  it("explicit task from config", () => {
    const md = buildPack({ data: { ...emptyData(), tasks } as any, config: { activeTaskId: "tj-1" } });
    expect(md).toContain("## Active task\n\ntj-1 — Alpha [open]");
  });
  it("heuristic: the first open one when config is empty", () => {
    const md = buildPack({ data: { ...emptyData(), tasks } as any, config: {} });
    expect(md).toMatch(/## Active task\n\ntj-1 — Alpha \[open\] \(heuristic/);
  });
  it("id from config but missing from tasks → (not in the journal)", () => {
    const md = buildPack({ data: { ...emptyData(), tasks } as any, config: { activeTaskId: "tj-X" } });
    expect(md).toContain("tj-X — (not in journal)");
  });
  it("unavailable when there are no tasks", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("## Active task\n\n_unavailable");
  });
});

describe("sectionDecisions/Rejections", () => {
  const taskEvents = [
    { event_id: "e1", task_id: "tj-1", type: "decision", text: "chose X", timestamp: "2026-06-01T10:00:00Z" },
    { event_id: "e2", task_id: "tj-1", type: "decision", text: "chose Y", timestamp: "2026-06-01T11:00:00Z" },
    { event_id: "e3", task_id: "tj-1", type: "rejection", text: "rejected Z", timestamp: "2026-06-01T10:30:00Z" },
  ];
  const base = { ...emptyData(), tasks: [{ id: "tj-1", title: "Alpha", status: "open" }], taskEvents } as any;
  it("decisions as a dash-prefixed list", () => {
    const md = buildPack({ data: base, config: { activeTaskId: "tj-1" } });
    expect(md).toContain("## Recent decisions");
    expect(md).toContain("- chose X");
    expect(md).toContain("- chose Y");
  });
  it("rejections as a list", () => {
    const md = buildPack({ data: base, config: { activeTaskId: "tj-1" } });
    expect(md).toContain("## Rejected approaches");
    expect(md).toContain("- rejected Z");
  });
  it("no decisions → honest placeholder", () => {
    const md = buildPack({ data: { ...emptyData(), tasks: [{ id:"tj-9", title:"E", status:"open" }] } as any, config: { activeTaskId: "tj-9" } });
    expect(md).toMatch(/## Recent decisions\n\n_no recorded decisions_/);
  });
});

describe("sectionTokenUsage", () => {
  it("unavailable when there are no tokens", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("## Token usage\n\n_unavailable: no token data_");
  });
  it("project total + active task (time-based estimate)", () => {
    const data = {
      ...emptyData(),
      tokens: [{ sessionId: "s", used: 100, saved: 20 }],
      tokenEvents: [{ sessionId: "s", used: 100, saved: 20, ts: Date.parse("2026-06-01T10:30:00Z"), agentType: null }],
      taskEvents: [
        { event_id:"e1", task_id: "tj-1", type:"open", text:"", timestamp: "2026-06-01T10:00:00Z" },
        { event_id:"e2", task_id: "tj-1", type:"decision", text:"d", timestamp: "2026-06-01T11:00:00Z" },
      ],
      tasks: [{ id: "tj-1", title: "Alpha", status: "open" }],
    } as any;
    const md = buildPack({ data, config: { activeTaskId: "tj-1" } });
    expect(md).toMatch(/Project total: spent 100 · saved 20/);
    expect(md).toMatch(/Active task: spent 100 · saved 20 \(time-based estimate\)/);
  });
});

describe("sectionMcpHealth", () => {
  it("ok when there are no problems or errors", () => {
    const data = { ...emptyData(), health: [{ profile: "work", valid: ["a"], broken: [], missing: [], orphaned: [], conflicts: [] }] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toContain("- work: ok");
  });
  it("problems when broken/missing/conflicts are non-empty", () => {
    const data = { ...emptyData(), health: [{ profile: "work", valid: [], broken: ["x"], missing: ["y"], orphaned: [], conflicts: ["z"] }] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toMatch(/- work: problems — broken 1, missing 1, conflicts 1/);
  });
  it("shows layer load errors", () => {
    const data = { ...emptyData(), errors: ["aimux: boom"] } as any;
    const md = buildPack({ data, config: {} });
    expect(md).toContain("Layer load errors:");
    expect(md).toContain("- aimux: boom");
  });
  it("all clean → every layer returned data without errors", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("all layers returned data without errors");
  });
});
