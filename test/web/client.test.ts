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

  it("doctor() returns the prereq report (D2.2)", async () => {
    const rep = { ok: true, tools: [{ name: "claude", found: true, hint: "" }], missing: [] };
    const c = createClient("", fakeFetch({ "/api/doctor": rep }));
    expect((await c.doctor()).ok).toBe(true);
    expect((await c.doctor()).tools[0].name).toBe("claude");
  });

  it("memoryTask() unwraps detail", async () => {
    const c = createClient("", fakeFetch({ "/api/memory/tasks/tj-1": { detail: { decisions: [1], findings: [], rejections: [] } } }));
    expect((await c.memoryTask("tj-1")).decisions).toEqual([1]);
  });

  it("recall() unwraps decisions/rejections; search() unwraps hits (L7)", async () => {
    const c = createClient("", fakeFetch({
      "/api/knowledge/recall?q=axum": { hits: [], decisions: [{ taskId: "t1", eventType: "decision", text: "use axum", score: 1 }], rejections: [] },
      "/api/knowledge/search?q=axum": { hits: [{ taskId: "t2", eventType: "finding", text: "axum tuned", score: 0.5 }] },
    }));
    expect((await c.recall("axum")).decisions[0].text).toBe("use axum");
    expect((await c.search("axum")).hits[0].taskId).toBe("t2");
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

  it("startRun() returns the runId; runStreamUrl builds the SSE path (L4.5)", async () => {
    const c = createClient("", fakeFetch({ "/api/tasks/t1/stages/rd/run": { runId: "run_x" } }));
    expect(await c.startRun("t1", "rd")).toBe("run_x");
    expect(createClient("/base").runStreamUrl("run_x")).toBe("/base/api/runs/run_x/stream");
  });

  it("installMissingStreamUrl builds the auto-installer SSE path (D2.2)", () => {
    expect(createClient("/base").installMissingStreamUrl()).toBe("/base/api/onboarding/install/stream");
  });

  it("moveTask() posts the target stage and returns the new current", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetchSpy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).replace(/^https?:\/\/[^/]+/, "");
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ current: "spec" }), { status: 200 });
    }) as typeof fetch;
    const c = createClient("", fetchSpy);
    expect((await c.moveTask("t1", "spec")).current).toBe("spec");
    expect(calls[0]).toEqual({ path: "/api/tasks/t1/move", body: { stageKey: "spec" } });
  });

  it("fsList() lists a directory (with and without a path query)", async () => {
    const listing = { path: "/home", parent: "/", entries: [{ name: "repo", path: "/home/repo", isGitRepo: true }] };
    const c = createClient("", fakeFetch({ "/api/fs/list": listing, "/api/fs/list?path=%2Fhome": listing }));
    expect((await c.fsList()).entries[0].isGitRepo).toBe(true);
    expect((await c.fsList("/home")).path).toBe("/home");
  });

  it("sendStdin() posts data to the run; prRun() passes the connector flag", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetchSpy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = (typeof input === "string" ? input : input.toString()).replace(/^https?:\/\/[^/]+/, "");
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const payload = path.endsWith("/stdin") ? { ok: true } : { pr: { description: "d", created: true, url: "u" } };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;
    const c = createClient("", fetchSpy);
    await c.sendStdin("run_1", "y\n");
    const pr = await c.prRun("t1", { connector: true });
    expect(calls[0]).toEqual({ path: "/api/runs/run_1/stdin", body: { data: "y\n" } });
    expect(calls[1]).toEqual({ path: "/api/tasks/t1/pr/run", body: { connector: true } });
    expect(pr.created).toBe(true);
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
    expect(stageIcon("active")).toBe("●");
    expect(stageIcon("pending")).toBe(""); // neutral empty circle, not an alert glyph
  });
});
