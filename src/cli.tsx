#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { loadDynamicPlugins } from "./core/plugins/index.js";
import { runPluginCli } from "./cli/plugin-cli.js";
import { runPackCli } from "./cli/pack-cli.js";
import { runConfigCli } from "./cli/config-cli.js";
import { defaultDeps } from "./core/install/runner.js";
import { takeHandover } from "./core/handover.js";

async function main(): Promise<void> {
  // `loom plugin <add|remove|list>` → headless CLI без рендера TUI.
  if (process.argv[2] === "plugin") {
    const res = runPluginCli(process.argv.slice(3), defaultDeps());
    for (const l of res.lines) console.log(l);
    process.exit(res.code);
  }

  // `loom pack [--out <file>] [--copy]` → headless CLI без рендера TUI.
  if (process.argv[2] === "pack") {
    const res = await runPackCli(process.argv.slice(3), {});
    for (const l of res.lines) console.log(l);
    process.exit(res.code);
  }

  // `loom config <doctor|merge>` → headless CLI без рендера TUI.
  if (process.argv[2] === "config") {
    const res = runConfigCli(process.argv.slice(3), {});
    for (const l of res.lines) console.log(l);
    process.exit(res.code);
  }

  // Иначе — обычный TUI. Наполняем реестр динамическими плагинами ДО первого
  // рендера, чтобы App видел полный список. Ошибки загрузки не валят запуск.
  const errs = await loadDynamicPlugins();
  if (errs.length) {
    console.error("Loom: проблемы загрузки плагинов:\n" + errs.join("\n"));
  }

  const app = render(<App />);
  await app.waitUntilExit();
  const handover = takeHandover();
  if (handover) {
    await handover();
  }
}

await main();
