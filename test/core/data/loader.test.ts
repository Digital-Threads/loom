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
  it("грузит данные асинхронно и не бросает при ошибке плагина", async () => {
    const data = await loadWorkspaceData();
    expect(data).toHaveProperty("subscriptions");
    expect(data).toHaveProperty("sessions");
    expect(data).toHaveProperty("health");
    expect(data).toHaveProperty("errors");
    expect(Array.isArray(data.errors)).toBe(true);
  });

  it("отдаёт projectId (16 hex) от резолвнутого корня", async () => {
    const data = await loadWorkspaceData();
    expect(data).toHaveProperty("projectId");
    expect(data.projectId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("isWorkspaceEmpty", () => {
  it("пустой WorkspaceData → true", () => {
    expect(isWorkspaceEmpty(emptyData())).toBe(true);
  });

  it("errors/health не считаются полезными данными → всё ещё true", () => {
    const d = emptyData();
    d.errors = ["aimux: boom"];
    d.health = [{ id: "x" }] as WorkspaceData["health"];
    expect(isWorkspaceEmpty(d)).toBe(true);
  });

  it("одна подписка → false", () => {
    const d = emptyData();
    d.subscriptions = [{}] as WorkspaceData["subscriptions"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("одна сессия → false", () => {
    const d = emptyData();
    d.sessions = [{}] as WorkspaceData["sessions"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("один токен → false", () => {
    const d = emptyData();
    d.tokens = [{}] as WorkspaceData["tokens"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("одно событие задачи → false", () => {
    const d = emptyData();
    d.taskEvents = [{}] as WorkspaceData["taskEvents"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });

  it("одна задача → false", () => {
    const d = emptyData();
    d.tasks = [{}] as WorkspaceData["tasks"];
    expect(isWorkspaceEmpty(d)).toBe(false);
  });
});
