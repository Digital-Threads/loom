import { describe, it, expect } from "vitest";
import { createAimuxStageAgent } from "../../../src/core/pipeline/stage-agent.js";

// Capture the args a one-shot stage agent would hand the CLI, without aimux: a
// fake launch records the extraArgs; a truthy loadConfig + explicit profile keep
// it from short-circuiting to "".
function harness(effort?: string) {
  const calls: Array<{ model?: string; extraArgs?: string[] }> = [];
  const launch = (async (_cfg: unknown, _profile: string, opts: { model?: string; extraArgs?: string[] }) => {
    calls.push(opts);
    return { stdout: "ok", code: 0 };
  }) as unknown as Parameters<typeof createAimuxStageAgent>[0]["launch"];
  const loadConfig = (() => ({ version: 1 })) as unknown as Parameters<typeof createAimuxStageAgent>[0]["loadConfig"];
  const agent = createAimuxStageAgent({ launch, loadConfig, profile: "work", effort });
  return { agent, calls };
}

describe("createAimuxStageAgent — reasoning effort (loom-daeq)", () => {
  it("appends --effort <level> to the CLI args when an effort is set", async () => {
    const { agent, calls } = harness("xhigh");
    await agent("draft the spec");
    const args = calls[0].extraArgs ?? [];
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--effort") + 1]).toBe("xhigh");
    expect(args).toContain("draft the spec"); // the prompt is still passed via -p
  });

  it("omits --effort when no effort is set", async () => {
    const { agent, calls } = harness();
    await agent("hi");
    expect(calls[0].extraArgs ?? []).not.toContain("--effort");
  });
});
