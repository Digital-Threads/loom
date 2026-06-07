import React from "react";
import { Box, Text } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";

export function OverviewPanel({ data }: { data: WorkspaceData }) {
  return (
    <Box flexDirection="column">
      <Text>Подписок: {data.subscriptions.length}</Text>
      <Text>Сессий: {data.sessions.length}</Text>
      {data.errors.length > 0 && <Text color="red">Ошибок загрузки: {data.errors.length}</Text>}
    </Box>
  );
}
