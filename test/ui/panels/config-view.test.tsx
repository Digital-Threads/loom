import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { ConfigView } from "../../../src/ui/panels/ConfigView.js";

const reports = [
  { scope: "user", ok: false, missingMcp: ["token-pilot"], changedMcp: [], missingHookEvents: [], mcpCollisions: [], hookCollisions: [] },
  { scope: "project", ok: true, missingMcp: [], changedMcp: [], missingHookEvents: [], mcpCollisions: [], hookCollisions: [] },
  { scope: "local", ok: true, missingMcp: [], changedMcp: [], missingHookEvents: [], mcpCollisions: [], hookCollisions: [] },
] as any;
const prereq = { ok: true, tools: [{ name: "node", found: true, hint: "" }], missing: [] } as any;

describe("ConfigView", () => {
  it("рендерит scope-секции и статусы", () => {
    const { lastFrame } = render(<ConfigView reports={reports} prereq={prereq} onApply={() => {}} />);
    const f = lastFrame()!;
    expect(f).toMatch(/user/);
    expect(f).toMatch(/project/);
    expect(f).toMatch(/token-pilot/); // missing запись видна
  });
  it("показывает Prerequisites", () => {
    const { lastFrame } = render(<ConfigView reports={reports} prereq={prereq} onApply={() => {}} />);
    expect(lastFrame()!.toLowerCase()).toMatch(/prerequisit|node/);
  });
  it("apply-хоткей вызывает onApply (а не пишет напрямую)", async () => {
    let applied = false;
    const { stdin } = render(<ConfigView reports={reports} prereq={prereq} onApply={() => { applied = true; }} />);
    await Promise.resolve();
    stdin.write("a");
    await Promise.resolve();
    expect(applied).toBe(true);
  });
});
