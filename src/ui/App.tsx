import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { Tabs } from "./Tabs.js";
import { loadWorkspaceData, isWorkspaceEmpty, type WorkspaceData } from "../core/data/loader.js";
import { loomRegistry } from "../core/plugins/index.js";
import { ViewRenderer } from "./views/ViewRenderer.js";
import { PluginsPanel } from "./panels/PluginsPanel.js";
import { CatalogPanel } from "./panels/CatalogPanel.js";
import { OnboardingPanel } from "./panels/OnboardingPanel.js";
import { overviewView, settingsView, tasksTokensView } from "./views/host-views.js";
import { buildPluginTabs } from "../core/dashboard/layers.js";
import type { LoomPlugin, ViewSpec } from "../core/plugins/types.js";

// Плагинные вкладки, сгруппированные по слою (порядок LAYER_ORDER), а не по реестру (LP4).
// Порядок слоёв: accounts → efficiency → memory → … (см. LAYER_ORDER в layers.ts).
// buildPluginTabs возвращает LayerTab[] с { pluginId, tabId, title }.
const pluginTabs = buildPluginTabs(loomRegistry.list());

// Порядок: Обзор, Каталог, Задачи и токены, [плагинные вкладки по слоям], Настройки, Плагины.
// "Каталог", "Задачи и токены" и "Плагины" — host-экраны. "Каталог"/"Плагины" — отдельные
// панели; "Задачи и токены" — кросс-слойный ViewSpec (рендерится тем же ViewRenderer).
const TABS = ["Обзор", "Каталог", "Задачи и токены", ...pluginTabs.map((t) => t.title), "Настройки", "Плагины"];

// Индекс host-вкладки каталога (сразу после «Обзора»).
const CATALOG_TAB = 1;
// Индекс host-вкладки «Задачи и токены» (кросс-слойный вид, сразу после «Каталога»).
const TASKS_TOKENS_TAB = 2;
// Индекс host-вкладки управления плагинами (последняя).
const PLUGINS_TAB = TABS.length - 1;
// Индекс host-вкладки настроек (предпоследняя).
const SETTINGS_TAB = TABS.length - 2;

// Маппинг таб → (плагин?, view-spec). 0 → host overview; TASKS_TOKENS_TAB → host tasks+tokens;
// SETTINGS_TAB → host settings; между — соответствующая плагинная вкладка (plugin.views[tabId]).
// PLUGINS_TAB сюда НЕ попадает — он рендерится <PluginsPanel/> напрямую в App.
function tabView(active: number): { plugin?: LoomPlugin; spec: ViewSpec | ViewSpec[] } | null {
  if (active === 0) return { spec: overviewView };
  if (active === TASKS_TOKENS_TAB) return { spec: tasksTokensView };
  if (active === SETTINGS_TAB) return { spec: settingsView };
  // Обзор=0, Каталог=1, Задачи и токены=2 — плагинные вкладки начинаются с индекса 3.
  const entry = pluginTabs[active - 3];
  if (!entry) return null;
  const plugin = loomRegistry.get(entry.pluginId);
  const spec = plugin?.views?.[entry.tabId];
  return spec ? { plugin, spec } : null;
}

export function App() {
  const { exit } = useApp();
  const [active, setActive] = useState(0);
  const [data, setData] = useState<WorkspaceData | null>(null);

  useEffect(() => {
    loadWorkspaceData().then((d) => {
      setData(d);
      // Пустой старт: уводим пользователя сразу в Каталог — оттуда ставят плагины.
      if (isWorkspaceEmpty(d)) setActive(CATALOG_TAB);
    });
  }, []);

  useInput((input, key) => {
    if (input === "q") exit();
    if (key.rightArrow) setActive((a) => (a + 1) % TABS.length);
    if (key.leftArrow) setActive((a) => (a - 1 + TABS.length) % TABS.length);
  });

  const view = data === null ? null : tabView(active);

  return (
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
        <Text dimColor>←/→ вкладки · q выход</Text>
      </Box>
    </Box>
  );
}
