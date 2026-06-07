import React from "react";
import { Box, Text } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";

export function TokensPanel({ data }: { data: WorkspaceData }) {
  if (!data.tokens.length) return <Text dimColor>Нет данных о токенах</Text>;
  const totalUsed = data.tokens.reduce((sum, t) => sum + t.used, 0);
  const totalSaved = data.tokens.reduce((sum, t) => sum + t.saved, 0);
  return (
    <Box flexDirection="column">
      <Text>Всего: потрачено {totalUsed} · сэкономлено {totalSaved}</Text>
      {data.tokens.map((t) => (
        <Text key={t.sessionId}>
          {t.sessionId.slice(0, 8)}  {String(t.used).padStart(8)}  {String(t.saved).padStart(8)}
        </Text>
      ))}
    </Box>
  );
}
