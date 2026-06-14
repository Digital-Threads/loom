import { describe, it, expect } from "vitest";
import { createAimuxExecutor, buildPrompt } from "../../../src/core/automation/aimux-executor.js";
import type { StepRow } from "../../../src/core/store/steps.js";

function step(partial: Partial<StepRow>): StepRow {
  return {
    id: "s1",
    task_id: "t1",
    title: "Add refund endpoint",
    approach: null,
    files: null,
    agent: null,
    model: null,
    profile: null,
    depends_on: null,
    status: "pending",
    exit_code: null,
    started_at: null,
    finished_at: null,
    ...partial,
  };
}

describe("buildPrompt", () => {
  it("includes title, approach and files", () => {
    const p = buildPrompt(step({ approach: "use Redis key", files: JSON.stringify(["a.ts", "b.ts"]) }));
    expect(p).toContain("Add refund endpoint");
    expect(p).toContain("Approach:\nuse Redis key");
    expect(p).toContain("Files: a.ts, b.ts");
  });

  it("title only when no approach/files", () => {
    expect(buildPrompt(step({}))).toBe("Add refund endpoint");
  });
});

describe("createAimuxExecutor", () => {
  const fakeCfg = { version: 1, shared_source: "/x", profiles: {}, private: [] } as never;

  it("launches the step's profile with spine ids and prompt", async () => {
    const calls: unknown[] = [];
    const exec = createAimuxExecutor({
      loadConfig: () => fakeCfg,
      launch: async (cfg, profile, opts) => {
        calls.push({ cfg, profile, opts });
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });

    const res = await exec.run({
      taskId: "t1",
      step: step({ profile: "work", model: "claude-opus-4-8" }),
      ids: { projectId: "p1", taskId: "tj-1", workflowId: "wf-1", profileId: "fallback" },
    });

    expect(res).toEqual({ exitCode: 0, stdout: "done", stderr: "" });
    expect(calls).toHaveLength(1);
    const call = calls[0] as { profile: string; opts: Record<string, unknown> };
    expect(call.profile).toBe("work"); // step profile wins over ids.profileId
    expect(call.opts).toMatchObject({ taskId: "tj-1", workflowId: "wf-1", model: "claude-opus-4-8" });
    expect((call.opts.extraArgs as string[])[0]).toBe("-p");
  });

  it("falls back to ids.profileId when step has no profile", async () => {
    let usedProfile = "";
    const exec = createAimuxExecutor({
      loadConfig: () => fakeCfg,
      launch: async (_cfg, profile) => {
        usedProfile = profile;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    await exec.run({ taskId: "t1", step: step({}), ids: { projectId: "p1", profileId: "personal" } });
    expect(usedProfile).toBe("personal");
  });

  it("returns exit 1 when no config", async () => {
    const exec = createAimuxExecutor({ loadConfig: () => null, launch: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const res = await exec.run({ taskId: "t1", step: step({ profile: "work" }), ids: { projectId: "p1" } });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no config");
  });

  it("returns exit 1 when no profile resolvable", async () => {
    const exec = createAimuxExecutor({ loadConfig: () => fakeCfg, launch: async () => ({ exitCode: 0, stdout: "", stderr: "" }) });
    const res = await exec.run({ taskId: "t1", step: step({}), ids: { projectId: "p1" } });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("no profile");
  });
});
