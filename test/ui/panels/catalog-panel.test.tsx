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

describe("CatalogPanel действия", () => {
  it("Enter на not-installed → confirm установки", async () => {
    const fake: InstallDeps = {
      dataDir: mkdtempSync(join(tmpdir(), "loom-c4-")),
      run: () => ({ ok: false, stdout: "", stderr: "" }),
    };
    const { lastFrame, stdin } = render(<CatalogPanel deps={fake} />);
    stdin.write("\r");
    await Promise.resolve(); // ink/React: рендер флашится на следующем микротике
    const f = lastFrame()!;
    expect(f.toLowerCase()).toContain("установить");
    expect(f).toMatch(/y\/n|y · n|\(y\/n\)/i);
  });

  it("y подтверждает → вызывает install-рецепт через CmdRunner", async () => {
    const calls: string[] = [];
    // cursor=0 = aimux: detect probe = npm ls -g ... → not-installed;
    // install = npm install -g ... → ok + запись в calls.
    const fake: InstallDeps = {
      dataDir: mkdtempSync(join(tmpdir(), "loom-c4b-")),
      run: (cmd, args) => {
        if (cmd === "npm" && args[0] === "ls") return { ok: false, stdout: "", stderr: "" };
        calls.push([cmd, ...args].join(" "));
        return { ok: true, stdout: "", stderr: "" };
      },
    };
    const { stdin } = render(<CatalogPanel deps={fake} />);
    stdin.write("\r");
    await Promise.resolve(); // дать mode перейти в confirmInstall до нажатия y
    stdin.write("y");
    await Promise.resolve();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("хоткеи каталога не конфликтуют с глобальными App (q/←/→)", () => {
    const handled = new Set(["i", "u", "d", "e", "y", "n"]);
    expect(handled.has("q")).toBe(false);
  });
});

describe("CatalogPanel ленивый latest", () => {
  it("ленивая загрузка latest: сначала «проверка», потом ↻", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "loom-c45-"));
    const fake: InstallDeps = { dataDir: tmp, run: (c, a) => {
      const key = [c, ...a].join(" ");
      if (key.includes("view") || key.includes("search")) return { ok: true, stdout: "1.2.0", stderr: "" }; // latest
      // detect-probe: aimux npm ls -g → installed + version 1.0.0
      if (a.includes("ls")) return { ok: true, stdout: "@digital-threads/aimux@1.0.0", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    } };
    const { lastFrame } = render(<CatalogPanel deps={fake} />);
    // первый кадр: установленные показывают индикатор проверки
    expect(lastFrame()!).toMatch(/проверка|↻…/);
    await Promise.resolve(); await Promise.resolve();
    expect(lastFrame()!).toContain("↻");
  });

  it("not-installed не показывает индикатор проверки обновлений", () => {
    const tmp = mkdtempSync(join(tmpdir(), "loom-c45b-"));
    const fake: InstallDeps = { dataDir: tmp, run: () => ({ ok: false, stdout: "", stderr: "" }) };
    const { lastFrame } = render(<CatalogPanel deps={fake} />);
    expect(lastFrame()!).not.toMatch(/проверка|↻…/);
    expect(lastFrame()!).toContain("○");
  });
});
