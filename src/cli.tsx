#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { loadDynamicPlugins } from "./core/plugins/index.js";

// Наполняем реестр динамическими плагинами ДО первого рендера, чтобы App
// видел полный список. Ошибки загрузки не валят запуск — только печатаем.
const errs = await loadDynamicPlugins();
if (errs.length) {
  console.error("Loom: проблемы загрузки плагинов:\n" + errs.join("\n"));
}

render(<App />);
