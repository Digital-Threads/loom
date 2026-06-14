import { describe, it, expect } from "vitest";
import { createClient } from "../../web/src/api";
import { statusLabel, statusClass, stageStateClass, stageIcon } from "../../web/src/ui";

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (!(path in routes)) return new Response("nf", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as typeof fetch;
}

describe("web api client", () => {
  it("board() unwraps columns", async () => {
    const c = createClient("", fakeFetch({ "/api/board": { columns: [{ stageKey: "analysis", cards: [] }] } }));
    expect(await c.board()).toEqual([{ stageKey: "analysis", cards: [] }]);
  });

  it("attention() and tasks() unwrap their fields", async () => {
    const c = createClient(
      "",
      fakeFetch({ "/api/attention": { items: [{ taskId: "t1", title: "T", stageKey: "spec" }] }, "/api/tasks": { tasks: [{ id: "t1" }] } }),
    );
    expect((await c.attention())[0].taskId).toBe("t1");
    expect((await c.tasks())[0].id).toBe("t1");
  });

  it("task(id) returns the detail object", async () => {
    const detail = { task: { id: "t1" }, stages: [], steps: [], costs: [] };
    const c = createClient("", fakeFetch({ "/api/tasks/t1": detail }));
    expect((await c.task("t1")).task.id).toBe("t1");
  });

  it("throws on non-ok response", async () => {
    const c = createClient("", fakeFetch({}));
    await expect(c.board()).rejects.toThrow(/404/);
  });

  it("create() posts and returns the task", async () => {
    const c = createClient("", fakeFetch({ "/api/tasks": { task: { id: "t9", title: "X" } } }));
    expect((await c.create({ title: "X" })).id).toBe("t9");
  });

  it("accept() returns the next stage", async () => {
    const c = createClient("", fakeFetch({ "/api/tasks/t1/stages/analysis/accept": { next: "brainstorm" } }));
    expect((await c.accept("t1", "analysis")).next).toBe("brainstorm");
  });

  it("start() and setGate() resolve", async () => {
    const c = createClient(
      "",
      fakeFetch({ "/api/tasks/t1/start": { active: "analysis" }, "/api/tasks/t1/stages/spec/gate": { ok: true } }),
    );
    expect((await c.start("t1")).active).toBe("analysis");
    expect((await c.setGate("t1", "spec", false)).ok).toBe(true);
  });

  // F1 — 3 core modules
  it("workspace() returns the aggregated 3-module data", async () => {
    const ws = { subscriptions: [{ profile: "work" }], sessions: [], health: [], tokens: [], tokenEvents: [], taskEvents: [], tasks: [], errors: [], projectId: "p1" };
    const c = createClient("", fakeFetch({ "/api/workspace": ws }));
    expect((await c.workspace()).subscriptions[0].profile).toBe("work");
  });

  it("accountsHealth() unwraps health, setActive() unwraps active", async () => {
    const c = createClient(
      "",
      fakeFetch({ "/api/accounts/health": { health: [{ profile: "work", ok: true }] }, "/api/accounts/active": { active: "main" } }),
    );
    expect((await c.accountsHealth())[0].profile).toBe("work");
    expect(await c.setActive("main")).toBe("main");
  });

  it("memoryTask() unwraps detail", async () => {
    const c = createClient("", fakeFetch({ "/api/memory/tasks/tj-1": { detail: { decisions: [1], findings: [], rejections: [] } } }));
    expect((await c.memoryTask("tj-1")).decisions).toEqual([1]);
  });

  it("projects()/addProject()/setActiveProject() (D3)", async () => {
    const c = createClient(
      "",
      fakeFetch({
        "/api/projects": { projects: [{ projectId: "p1", root: "/r", name: "r", addedAt: 0 }], active: "p1" },
      }),
    );
    const d = await c.projects();
    expect(d.active).toBe("p1");
    expect(d.projects[0].projectId).toBe("p1");
    const c2 = createClient("", fakeFetch({ "/api/projects": { project: { projectId: "p2", root: "/x", name: "x", addedAt: 0 } } }));
    expect((await c2.addProject("/x")).projectId).toBe("p2");
    const c3 = createClient("", fakeFetch({ "/api/projects/active": { active: "p9" } }));
    expect(await c3.setActiveProject("p9")).toBe("p9");
  });
});

describe("web ui helpers", () => {
  it("statusLabel maps known statuses", () => {
    expect(statusLabel("running")).toBe("running");
    expect(statusLabel("done")).toBe("done");
    expect(statusLabel("zzz")).toBe("zzz");
  });
  it("statusClass + stage helpers", () => {
    expect(statusClass("active")).toBe("run");
    expect(stageStateClass("done")).toBe("done");
    expect(stageStateClass("active")).toBe("active2");
    expect(stageIcon("done")).toBe("✓");
    expect(stageIcon("pending")).toBe("!");
  });
});
