import { describe, it, expect } from "vitest";
import { buildPack } from "../../../src/core/pack/build-pack.js";
import type { WorkspaceData } from "../../../src/core/data/loader.js";

function emptyData(): WorkspaceData {
  return { subscriptions: [], sessions: [], health: [], tokens: [], tokenEvents: [],
    taskEvents: [], tasks: [], projectId: "", errors: [] } as any;
}

describe("buildPack каркас", () => {
  it("начинается с # Workspace pack и содержит Project", () => {
    const md = buildPack({ data: emptyData(), config: { projectName: "demo" } });
    expect(md.startsWith("# Workspace pack")).toBe(true);
    expect(md).toContain("Project: demo");
  });
  it("Project: — при отсутствии имени", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toContain("Project: —");
  });
  it("заканчивается footer-нотой про оценку токенов по времени", () => {
    const md = buildPack({ data: emptyData(), config: {} });
    expect(md).toMatch(/оценка по врем|double-count/i);
  });
  it("детерминирован (один вход → один текст)", () => {
    const a = buildPack({ data: emptyData(), config: { projectName: "x" } });
    const b = buildPack({ data: emptyData(), config: { projectName: "x" } });
    expect(a).toBe(b);
  });
});
