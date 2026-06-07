import { describe, it, expect } from "vitest";
import { deriveProjectId, resolveProjectRoot } from "../../../src/core/workspace/project-id.js";
import { createHash } from "node:crypto";

describe("LP8 deriveProjectId — собственная стабильная метка Loom", () => {
  it("id = первые 16 hex от sha256 пути (детерминированная функция)", () => {
    const p = "/tmp/some/project";
    const expected = createHash("sha256").update(p).digest("hex").slice(0, 16);
    expect(deriveProjectId(p)).toBe(expected);
  });
  it("детерминирован и имеет длину 16 hex", () => {
    const a = deriveProjectId("/tmp/x");
    expect(a).toBe(deriveProjectId("/tmp/x"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("resolveProjectRoot возвращает абсолютный путь для пути внутри репо", () => {
    const root = resolveProjectRoot(process.cwd());
    expect(root.startsWith("/")).toBe(true);
  });
  it("resolveProjectRoot для не-git пути возвращает сам путь", () => {
    expect(resolveProjectRoot("/tmp")).toBe("/tmp");
  });
});
