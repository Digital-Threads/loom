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
  it("renders the scope sections and statuses", () => {
    const { lastFrame } = render(<ConfigView reports={reports} prereq={prereq} onApply={() => {}} />);
    const f = lastFrame()!;
    expect(f).toMatch(/user/);
    expect(f).toMatch(/project/);
    expect(f).toMatch(/token-pilot/); // the missing entry is visible
  });
  it("shows Prerequisites", () => {
    const { lastFrame } = render(<ConfigView reports={reports} prereq={prereq} onApply={() => {}} />);
    expect(lastFrame()!.toLowerCase()).toMatch(/prerequisit|node/);
  });
  it("apply hotkey calls onApply (instead of writing directly)", async () => {
    let applied = false;
    const { stdin } = render(<ConfigView reports={reports} prereq={prereq} onApply={() => { applied = true; }} />);
    await Promise.resolve();
    stdin.write("a");
    await Promise.resolve();
    expect(applied).toBe(true);
  });
});
