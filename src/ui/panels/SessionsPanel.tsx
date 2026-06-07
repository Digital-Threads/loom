import React from "react";
import { Box, Text } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";

export function SessionsPanel({ data }: { data: WorkspaceData }) {
  if (!data.sessions.length) return <Text dimColor>Нет сессий</Text>;
  return (
    <Box flexDirection="column">
      {data.sessions.map((s) => (
        <Text key={s.sessionId}>
          {s.sessionId.slice(0, 8)}  {s.profile.padEnd(12)}
        </Text>
      ))}
    </Box>
  );
}
