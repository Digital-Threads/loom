import React, { useState, useEffect } from "react";
import { homedir } from "node:os";
import { Box, Text, useInput, useApp } from "ink";
import { Tabs } from "./Tabs.js";
import { loadWorkspaceData, isWorkspaceEmpty, type WorkspaceData } from "../core/data/loader.js";
import { loomRegistry } from "../core/plugins/index.js";
import { ViewRenderer } from "./views/ViewRenderer.js";
import { PluginsPanel } from "./panels/PluginsPanel.js";
import { CatalogPanel } from "./panels/CatalogPanel.js";
import { ConfigView } from "./panels/ConfigView.js";
import { OnboardingPanel } from "./panels/OnboardingPanel.js";
import { overviewView, settingsView, tasksTokensView, timelineView } from "./views/host-views.js";
import { buildPluginTabs } from "../core/dashboard/layers.js";
import { diagnoseAll } from "../core/doctor/doctor.js";
import { runMerge } from "../core/doctor/apply.js";
import { checkPrerequisites } from "../core/doctor/prereqs.js";
import type { ScopeDirs, PluginContribution } from "../core/doctor/types.js";
import type { LoomPlugin, ViewSpec } from "../core/plugins/types.js";
import { InputModeContext } from "./input/InputModeContext.js";

// Плагинные вкладки, сгруппированные по слою (порядок LAYER_ORDER), а не по реестру (LP4).
// Порядок слоёв: accounts → efficiency → memory → … (см. LAYER_ORDER в layers.ts).
// buildPluginTabs возвращает LayerTab[] с { pluginId, tabId, title }.
const pluginTabs = buildPluginTabs(loomRegistry.list());

// Порядок: Обзор, Каталог, Задачи и токены, Лента, Config, [плагинные вкладки по слоям], Настройки, Плагины.
// "Каталог", "Задачи и токены", "Лента", "Config" и "Плагины" — host-экраны. "Каталог"/"Config"/"Плагины" —
// отдельные панели; "Задачи и токены"/"Лента" — кросс-слойные ViewSpec (тот же ViewRenderer).
const TABS = ["Обзор", "Каталог", "Задачи и токены", "Лента", "Config", ...pluginTabs.map((t) => t.title), "Настройки", "Плагины"];

// Индекс host-вкладки каталога (сразу после «Обзора»).
const CATALOG_TAB = 1;
// Индекс host-вкладки «Задачи и токены» (кросс-слойный вид, сразу после «Каталога»).
const TASKS_TOKENS_TAB = 2;
// Индекс host-вкладки «Лента» (кросс-слойная хронология, сразу после «Задач и токенов»).
const TIMELINE_TAB = 3;
// Индекс host-вкладки Config (doctor + prerequisites), сразу после «Ленты».
const CONFIG_TAB = 4;
// Индекс host-вкладки управления плагинами (последняя).
const PLUGINS_TAB = TABS.length - 1;
// Индекс host-вкладки настроек (предпоследняя).
const SETTINGS_TAB = TABS.length - 2;

// Маппинг таб → (плагин?, view-spec). 0 → host overview; TASKS_TOKENS_TAB → host tasks+tokens;
// TIMELINE_TAB → host timeline; SETTINGS_TAB → host settings; между — соответствующая плагинная
// вкладка (plugin.views[tabId]).
// PLUGINS_TAB сюда НЕ попадает — он рендерится <PluginsPanel/> напрямую в App.
// Каталог взносов плагинов для doctor-вкладки. Пока [] (как в config-cli): формализация
// сбора PluginContribution из установленных плагинов — отдельная задача (LP позже).
const configDirs: ScopeDirs = { homeDir: homedir(), projectDir: process.cwd() };
const configContributions: PluginContribution[] = [];

function tabView(active: number): { plugin?: LoomPlugin; spec: ViewSpec | ViewSpec[] } | null {
  if (active === 0) return { spec: overviewView };
  if (active === TASKS_TOKENS_TAB) return { spec: tasksTokensView };
  if (active === TIMELINE_TAB) return { spec: timelineView };
  if (active === SETTINGS_TAB) return { spec: settingsView };
  // Обзор=0, Каталог=1, Задачи и токены=2, Лента=3, Config=4 — плагинные вкладки с индекса 5.
  const entry = pluginTabs[active - 5];
  if (!entry) return null;
  const plugin = loomRegistry.get(entry.pluginId);
  const spec = plugin?.views?.[entry.tabId];
  return spec ? { plugin, spec } : null;
}

export function App() {
  const { exit } = useApp();
  const [active, setActive] = useState(0);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    loadWorkspaceData().then((d) => {
      setData(d);
      // Пустой старт: уводим пользователя сразу в Каталог — оттуда ставят плагины.
      if (isWorkspaceEmpty(d)) setActive(CATALOG_TAB);
    });
  }, []);

  useInput((input, key) => {
    // В режиме свободного текст-ввода глобальные хоткеи молчат (иначе буквы/'q'
    // уходят сюда вместо поля ввода).
    if (capturing) return;
    if (input === "q") exit();
    if (key.rightArrow) setActive((a) => (a + 1) % TABS.length);
    if (key.leftArrow) setActive((a) => (a - 1 + TABS.length) % TABS.length);
    // loom-sns: прямой выбор вкладки цифрами 1-9.
    if (/^[1-9]$/.test(input)) {
      const i = Number(input) - 1;
      if (i < TABS.length) setActive(i);
    }
  });

  const view = data === null ? null : tabView(active);

  return (
    <InputModeContext.Provider value={{ capturing, setCapturing }}>
    <Box flexDirection="column">
      <Tabs tabs={TABS} active={active} />
      <Box marginTop={1} flexDirection="column">
        {data === null ? (
          <Text dimColor>Загрузка…</Text>
        ) : active === 0 && isWorkspaceEmpty(data) ? (
          // Пустой старт: на «Обзоре» вместо нулей показываем онбординг.
          // Прочие вкладки (Плагины/Настройки) работают как обычно — туда можно уйти.
          <OnboardingPanel key={active} />
        ) : active === CATALOG_TAB ? (
          // Host-экран каталога плагинов — не ViewSpec. key={active} перемонтирует панель.
          <CatalogPanel key={active} />
        ) : active === CONFIG_TAB ? (
          // Host-экран Config (doctor + prerequisites) — не ViewSpec. reports/prereq
          // вычисляются лениво при рендере вкладки (не на маунте App). Запись только
          // через runMerge (инъекция onApply/onDryRun); компонент — презентационный.
          <ConfigView
            key={active}
            reports={diagnoseAll(configContributions, configDirs)}
            prereq={checkPrerequisites()}
            onApply={() => runMerge({ scope: "user", contributions: configContributions, dirs: configDirs, apply: true })}
            onDryRun={() => runMerge({ scope: "user", contributions: configContributions, dirs: configDirs, apply: false })}
          />
        ) : active === PLUGINS_TAB ? (
          // Host-экран управления плагинами — не ViewSpec. key={active} перемонтирует панель.
          <PluginsPanel key={active} />
        ) : view ? (
          // key={active} → смена вкладки перемонтирует ViewRenderer (сброс стека/курсора).
          <ViewRenderer key={active} plugin={view.plugin} spec={view.spec} data={data} />
        ) : (
          <Text dimColor>Нет данных</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>←/→ или 1-9 вкладки · q выход</Text>
      </Box>
    </Box>
    </InputModeContext.Provider>
  );
}
