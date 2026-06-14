import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPINE_ENV,
  readSpineIds,
  spineEnv,
  deriveProjectId,
  type SpineIds,
} from "../../../src/core/spine/ids.js";
import { makeEvent } from "../../../src/core/spine/event.js";
import {
  appendLoomEvent,
  loadLoomEvents,
  eventLogPath,
} from "../../../src/core/spine/event-bus.js";

describe("spine/ids", () => {
  it("deriveProjectId is deterministic and 16 hex", () => {
    const a = deriveProjectId("/home/user/proj");
    expect(a).toBe(deriveProjectId("/home/user/proj"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(deriveProjectId("/home/user/other"));
  });

  it("spineEnv → readSpineIds round-trips, omitting absent optionals", () => {
    const ids: SpineIds = { projectId: "p1", taskId: "tj-1", workflowId: "wf-1" };
    const env = spineEnv(ids);
    expect(env).toEqual({
      [SPINE_ENV.projectId]: "p1",
      [SPINE_ENV.taskId]: "tj-1",
      [SPINE_ENV.workflowId]: "wf-1",
    });
    expect(env[SPINE_ENV.profileId]).toBeUndefined();
    expect(readSpineIds(env)).toEqual(ids);
  });

  it("readSpineIds ignores env without spine vars", () => {
    expect(readSpineIds({ PATH: "/bin" })).toEqual({});
  });
});

describe("spine/event", () => {
  it("makeEvent stamps the schema", () => {
    const e = makeEvent({ ts: 1, source: "loom", projectId: "p1", type: "stage" });
    expect(e.schema).toBe("loom.event.v1");
    expect(e.source).toBe("loom");
  });
});

describe("spine/event-bus", () => {
  let prevXdg: string | undefined;
  let dir: string;

  beforeEach(() => {
    prevXdg = process.env.XDG_DATA_HOME;
    dir = mkdtempSync(join(tmpdir(), "loom-spine-"));
    process.env.XDG_DATA_HOME = dir; // loomDataDir() → <dir>/loom
  });

  afterEach(() => {
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  });

  it("append then load round-trips events in order", () => {
    const e1 = makeEvent({ ts: 1, source: "token-pilot", projectId: "p1", type: "tokens", metrics: { used: 10, saved: 4 } });
    const e2 = makeEvent({ ts: 2, source: "aimux", projectId: "p1", type: "session", profileId: "work" });
    appendLoomEvent("p1", e1);
    appendLoomEvent("p1", e2);
    expect(loadLoomEvents("p1")).toEqual([e1, e2]);
  });

  it("loadLoomEvents returns [] when the log is missing", () => {
    expect(loadLoomEvents("nope")).toEqual([]);
  });

  it("loadLoomEvents skips corrupt lines", () => {
    const path = eventLogPath("p2");
    mkdirSync(join(dir, "loom", "events"), { recursive: true });
    writeFileSync(
      path,
      `{"schema":"loom.event.v1","ts":1,"source":"loom","projectId":"p2","type":"a"}\n` +
        `not json\n` +
        `{"schema":"loom.event.v1","ts":2,"source":"loom","projectId":"p2","type":"b"}\n`,
    );
    expect(loadLoomEvents("p2").map((e) => e.type)).toEqual(["a", "b"]);
  });
});
