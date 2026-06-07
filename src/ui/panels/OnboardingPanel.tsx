import React from "react";
import { Box, Text } from "ink";

// Презентационный экран пустого старта (Phase 11.2).
// Показывается на вкладке «Обзор», когда isWorkspaceEmpty(data) === true:
// ни один плагин не отдал данных, и нули в сводке человеку ничего не говорят.
export function OnboardingPanel() {
  return (
    <Box flexDirection="column">
      <Text bold>Добро пожаловать в Loom</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Loom — единый дашборд для твоих инструментов (aimux, token-pilot,
          task-journal и др.).
        </Text>
        <Text dimColor>
          Сейчас данных нет — ни один плагин не отдаёт информацию.
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>С чего начать</Text>
        <Text>· ← Открой вкладку «Каталог»: выбери плагин, Enter — поставить.</Text>
        <Text>· Или из терминала: loom plugin add &lt;npm-пакет|путь&gt;</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Встроенные aimux / token-pilot / task-journal появятся здесь, когда у
          них будут данные — запусти их в своём проекте.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>←/→ вкладки · q выход</Text>
      </Box>
    </Box>
  );
}
