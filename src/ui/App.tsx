import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { Tabs } from "./Tabs.js";
import { loadWorkspaceData, type WorkspaceData } from "../core/data/loader.js";
import { SubscriptionsPanel } from "./panels/SubscriptionsPanel.js";
import { SessionsPanel } from "./panels/SessionsPanel.js";
import { TokensPanel } from "./panels/TokensPanel.js";
import { TasksPanel } from "./panels/TasksPanel.js";
import { OverviewPanel } from "./panels/OverviewPanel.js";
import { SettingsPanel } from "./panels/SettingsPanel.js";

const TABS = ["Обзор", "Подписки", "Сессии", "Задачи", "Токены", "Настройки"];

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

  return (
    <Box flexDirection="column">
      <Tabs tabs={TABS} active={active} />
      <Box marginTop={1} flexDirection="column">
        {data === null ? (
          <Text dimColor>Загрузка…</Text>
        ) : active === 0 ? (
          <OverviewPanel data={data} />
        ) : active === 1 ? (
          <SubscriptionsPanel data={data} />
        ) : active === 2 ? (
          <SessionsPanel data={data} />
        ) : active === 3 ? (
          <TasksPanel data={data} />
        ) : active === 4 ? (
          <TokensPanel data={data} />
        ) : (
          <SettingsPanel />
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>←/→ вкладки · q выход</Text>
      </Box>
    </Box>
  );
}
