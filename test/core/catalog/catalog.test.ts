import { describe, it, expect } from "vitest";
import { CATALOG_ENTRIES } from "../../../src/core/catalog/catalog-data.js";
import { resolveEntries, buildCatalog, applyLatest } from "../../../src/core/catalog/catalog.js";
import type { InstallDeps } from "../../../src/core/install/types.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpEmpty = mkdtempSync(join(tmpdir(), "loom-cat-"));
function depsWith(tmp: string, run: InstallDeps["run"]): InstallDeps {
  return { dataDir: tmp, run };
}
const okRun = (stdout = "") => () => ({ ok: true, stdout, stderr: "" });
const failRun = () => () => ({ ok: false, stdout: "", stderr: "" });
const spec = (versionRegex?: string) => ({ probe: { cmd: "which", args: ["x"] }, versionRegex });

describe("catalog-data", () => {
  it("static entry = only id/title/case (category/recipe are NOT duplicated)", () => {
    const ids = CATALOG_ENTRIES.map((e) => e.id).sort();
    expect(ids).toEqual(["aimux", "task-journal", "token-pilot"]);
    for (const e of CATALOG_ENTRIES) {
      expect(e.case.length).toBeGreaterThan(0);
      expect("category" in e).toBe(false);
      expect("recipe" in e).toBe(false);
    }
  });
  it("resolveEntries mixes in category (LP1 registry) + recipe (LP2 manifest)", () => {
    const resolved = resolveEntries();
    for (const e of resolved) {
      expect(e.category).toBeTruthy();
      expect(e.recipe).toBeDefined();
    }
  });
  it("categories match the layers of vision §5 (via the registry, not hardcoded)", () => {
    const byId = Object.fromEntries(resolveEntries().map((e) => [e.id, e.category]));
    expect(byId["aimux"]).toBe("accounts");
    expect(byId["token-pilot"]).toBe("efficiency");
    expect(byId["task-journal"]).toBe("memory");
  });
});

describe("buildCatalog", () => {
  it("○ not-installed: probe.ok=false and not in the registry", () => {
    const entries = [{ id:"x", title:"X", case:"c", category:"memory",
      recipe: { install:[], remove:[], detect: spec() } }];
    const items = buildCatalog(depsWith(tmpEmpty, failRun()), entries as any);
    expect(items[0].status).toBe("not-installed");
  });
  it("✓ installed: probe.ok=true, version from stdout", () => {
    const entries = [{ id:"x", title:"X", case:"c", category:"memory",
      recipe:{ install:[], remove:[], detect: spec("x@([0-9.]+)") } }];
    const items = buildCatalog(depsWith(tmpEmpty, okRun("x@1.0.0")), entries as any);
    expect(items[0].status).toBe("installed");
    expect(items[0].installedVersion).toBe("1.0.0");
  });
});

describe("applyLatest", () => {
  it("installed + latest>version → update-available", () => {
    const item = { id:"x", title:"X", case:"c", category:"memory",
      recipe:{ install:[], remove:[], detect:{ probe:{ cmd:"which", args:["x"] } } },
      status:"installed" as const, installedVersion:"1.0.0" };
    const up = applyLatest(item as any, "1.2.0");
    expect(up.status).toBe("update-available");
    expect(up.latestVersion).toBe("1.2.0");
  });
  it("latest === version → stays installed", () => {
    const item = { status:"installed" as const, installedVersion:"1.2.0" } as any;
    expect(applyLatest(item, "1.2.0").status).toBe("installed");
  });
  it("not-installed ignores latest", () => {
    expect(applyLatest({ status:"not-installed" as const } as any, "9.9.9").status).toBe("not-installed");
  });
});
