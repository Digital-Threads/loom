import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { Tabs } from "./Tabs.js";
import { loadWorkspaceData, type WorkspaceData } from "../core/data/loader.js";
import { loomRegistry } from "../core/plugins/index.js";
import { ViewRenderer } from "./views/ViewRenderer.js";
import { overviewView, settingsView } from "./views/host-views.js";
import type { LoomPlugin, ViewSpec } from "../core/plugins/types.js";

const TABS = ["Обзор", "Подписки", "Сессии", "Задачи", "Токены", "Настройки"];

// Маппинг таб → (плагин?, view-spec). Host-вкладки (Обзор/Настройки) — без плагина.
function tabView(active: number): { plugin?: LoomPlugin; spec: ViewSpec | ViewSpec[] } | null {
  const aimux = loomRegistry.get("aimux");
  const tokenPilot = loomRegistry.get("token-pilot");
  const taskJournal = loomRegistry.get("task-journal");
  switch (active) {
    case 0:
      return { spec: overviewView };
    case 1:
      return aimux?.views?.subscriptions ? { plugin: aimux, spec: aimux.views.subscriptions } : null;
    case 2:
      return aimux?.views?.sessions ? { plugin: aimux, spec: aimux.views.sessions } : null;
    case 3:
      return taskJournal?.views?.tasks ? { plugin: taskJournal, spec: taskJournal.views.tasks } : null;
    case 4:
      return tokenPilot?.views?.tokens ? { plugin: tokenPilot, spec: tokenPilot.views.tokens } : null;
    case 5:
      return { spec: settingsView };
    default:
      return null;
  }
}

export function App() {
  const { exit } = useApp();
  const [active, setActive] = useState(0);
  const [data, setData] = useState<WorkspaceData | null>(null);

  useEffect(() => {
    loadWorkspaceData().then(setData);
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
