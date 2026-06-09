import { describe, it, expect } from "vitest";
import {
  loadWorkspaceData,
  isWorkspaceEmpty,
  type WorkspaceData,
} from "../../../src/core/data/loader.js";

function emptyData(): WorkspaceData {
  return {
    subscriptions: [],
    sessions: [],
    health: [],
    tokens: [],
    tokenEvents: [],
    taskEvents: [],
    tasks: [],
    errors: [],
    projectId: "",
  };
}

describe("loader", () => {
  it("loads data asynchronously and does not throw on a plugin error", async () => {
    const data = await loadWorkspaceData();
    expect(data).toHaveProperty("subscriptions");
    expect(data).toHaveProperty("sessions");
    expect(data).toHaveProperty("health");
    expect(data).toHaveProperty("errors");
    expect(Array.isArray(data.errors)).toBe(true);
  });

  it("returns the projectId (16 hex) from the resolved root", async () => {
    const data = await loadWorkspaceData();
    expect(data).toHaveProperty("projectId");
    expect(data.projectId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("isWorkspaceEmpty", () => {
  it("empty WorkspaceData → true", () => {
    expect(isWorkspaceEmpty(emptyData())).toBe(true);
  });

  it("errors/health do not count as useful data → still true", () => {
    const d = emptyData();
    d.errors = ["aimux: boom"];
    d.health = [{ id: "x" }] as WorkspaceData["health"];
    expect(isWorkspaceEmpty(d)).toBe(true);
  });

  it("one subscription → false", () => {
    const d = emptyData();
    d.subscriptions = [{}] as WorkspaceData["subscriptions"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("one session → false", () => {
    const d = emptyData();
    d.sessions = [{}] as WorkspaceData["sessions"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("one token → false", () => {
    const d = emptyData();
    d.tokens = [{}] as WorkspaceData["tokens"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("one task event → false", () => {
    const d = emptyData();
    d.taskEvents = [{}] as WorkspaceData["taskEvents"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("one task → false", () => {
    const d = emptyData();
    d.tasks = [{}] as WorkspaceData["tasks"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });
});
