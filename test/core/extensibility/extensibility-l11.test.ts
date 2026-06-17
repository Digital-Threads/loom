import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeWitness } from "../../../src/core/extensibility/verify.js";
import { verifyPlugin } from "../../../src/core/extensibility/verify-plugin.js";
import { scaffoldPlugin } from "../../../src/core/extensibility/scaffold.js";
import { appendLoomEvent, loadLoomEvents } from "../../../src/core/spine/event-bus.js";
import { configureSecurity } from "../../../src/core/security/config.js";

describe("verifyPlugin (L11.1)", () => {
  let prevXdg: string | undefined;
  let dir: string;
  beforeEach(() => {
    prevXdg = process.env.XDG_DATA_HOME;
    dir = mkdtempSync(join(tmpdir(), "loom-ext-"));
    process.env.XDG_DATA_HOME = dir;
    // Mirror prod wiring (server.ts): forward security audits to the event bus,
    // else emitAudit is a no-op and the witness-mismatch audit never lands.
    configureSecurity({ emit: (projectId, ev) => appendLoomEvent(projectId, ev as never) });
  });
  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it("ok when files match the witness; mismatch → warn+audit (soft, not block)", () => {
    writeFileSync(join(dir, "a.js"), "alpha");
    const witness = computeWitness(dir, ["a.js"]);
    expect(verifyPlugin("p", dir, witness).ok).toBe(true);

    writeFileSync(join(dir, "a.js"), "tampered");
    const res = verifyPlugin("p", dir, witness, { projectId: "pext" });
    expect(res.ok).toBe(false);
    expect(res.drifted).toContain("a.js");
    const audits = loadLoomEvents("pext").filter((e) => e.type === "audit.plugin.verify");
    expect(audits.length).toBe(1); // warned, not blocked
  });
});

describe("scaffoldPlugin (L11.4 SDK)", () => {
  it("generates a manifest + adapter + README under the plugin name", () => {
    const files = scaffoldPlugin("my-layer");
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(["my-layer/plugin.json", "my-layer/src/adapter.ts", "my-layer/README.md"]);
    const manifest = JSON.parse(files[0].content);
    expect(manifest).toMatchObject({ type: "loom-plugin", name: "my-layer", apiVersion: "^1.0" });
    expect(files[1].content).toContain("export const plugin: LoomPlugin");
  });
});
