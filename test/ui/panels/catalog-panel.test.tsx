import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogPanel } from "../../../src/ui/panels/CatalogPanel.js";
import type { InstallDeps } from "../../../src/core/install/types.js";

const tmp = mkdtempSync(join(tmpdir(), "loom-catui-"));
const fakeDeps: InstallDeps = { dataDir: tmp, run: () => ({ ok: false, stdout: "", stderr: "" }) };

describe("CatalogPanel рендер", () => {
  it("пустой реестр → все ○ not-installed, видны кейсы и категории", () => {
    const { lastFrame } = render(<CatalogPanel deps={fakeDeps} />);
    const f = lastFrame()!;
    expect(f).toContain("○");
    expect(f).toContain("Token Pilot");
    expect(f).toContain("Экономия токенов");
    expect(f).toContain("efficiency");
  });
  it("футер показывает хоткеи каталога", () => {
    const { lastFrame } = render(<CatalogPanel deps={fakeDeps} />);
    expect(lastFrame()!).toContain("Enter");
  });
});
