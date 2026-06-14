import { describe, it, expect } from "vitest";
import { createAimuxDecomposer } from "../../../src/core/automation/decomposer-aimux.js";

const cfg = { profiles: {} } as never;
const fakeLaunch = (stdout: string) =>
  (async () => ({ exitCode: 0, stdout, stderr: "" })) as never;

describe("createAimuxDecomposer (L4.1)", () => {
  it("turns the agent's JSON output into a StepSpec[] via the planner profile", async () => {
    const dag = JSON.stringify([
      { id: "tests", title: "write tests" },
      { id: "impl", title: "implement", dependsOn: ["tests"] },
    ]);
    const d = createAimuxDecomposer({
      loadConfig: () => cfg,
      launch: fakeLaunch("here is the plan:\n" + dag),
      plannerProfile: "cheap",
    });
    const steps = await d.decompose("add a refund endpoint");
    expect(steps.map((s) => s.id)).toEqual(["tests", "impl"]);
    expect(steps[1].dependsOn).toEqual(["tests"]);
  });

  it("passes the cheap profile + model to the launch", async () => {
    const calls: { profile: string; model?: string }[] = [];
    const d = createAimuxDecomposer({
      loadConfig: () => cfg,
      launch: (async (_c: never, profile: string, opts: { model?: string }) => {
        calls.push({ profile, model: opts.model });
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }) as never,
      plannerProfile: "haiku-prof",
      plannerModel: "claude-haiku-4-5",
    });
    await d.decompose("x");
    expect(calls).toEqual([{ profile: "haiku-prof", model: "claude-haiku-4-5" }]);
  });

  it("falls back to pickProfile when no plannerProfile is set", async () => {
    const d = createAimuxDecomposer({
      loadConfig: () => cfg,
      launch: fakeLaunch("[]"),
      pickProfile: () => "fallback-prof",
    });
    expect(await d.decompose("x")).toEqual([]);
  });

  it("returns [] when there is no config or no profile", async () => {
    expect(await createAimuxDecomposer({ loadConfig: () => null as never, launch: fakeLaunch("[]") }).decompose("x")).toEqual([]);
    expect(
      await createAimuxDecomposer({ loadConfig: () => cfg, launch: fakeLaunch("[]"), pickProfile: () => undefined }).decompose("x"),
    ).toEqual([]);
  });
});
