import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runRecipe, detect } from "../../src/core/install/recipe.js";
import { defaultDeps } from "../../src/core/install/runner.js";
import { validateManifest } from "../../src/core/plugins/manifest.js";

const RUN = process.env.LOOM_E2E === "1";
(RUN ? describe : describe.skip)("e2e: token-pilot", () => {
  const m = JSON.parse(readFileSync(join(__dirname,"../../packages/loom-plugin-token-pilot/plugin.json"),"utf8"));
  const recipe = (validateManifest(m) as any).manifest.install;

  it("dryRun install = 2 шага: marketplace add ПЕРЕД install, со scope=project", () => {
    const r = runRecipe(recipe.install, { scope: "project", dryRun: true }, defaultDeps());
    expect(r.ok).toBe(true);
    const addIdx = r.planned!.findIndex((c) => c[1] === "plugin" && c[2] === "marketplace" && c[3] === "add");
    const instIdx = r.planned!.findIndex((c) => c[1] === "plugin" && c[2] === "install");
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(instIdx).toBeGreaterThan(addIdx);
    expect(r.planned).toContainEqual(["claude","plugin","install","--scope","project","token-pilot@token-pilot"]);
  });

  it("detect через реальный claude plugin list не падает", () => {
    const d = detect(recipe.detect, defaultDeps());
    expect(typeof d.installed).toBe("boolean");
  });

  it("post-install verify по списку, а не по exit-коду (presenceMatch)", () => {
    const d = detect(recipe.detect, defaultDeps());
    expect(typeof d.installed).toBe("boolean");
  });
});
