import React from "react";
import { Box, Text } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";

export function SessionsPanel({ data }: { data: WorkspaceData }) {
  if (!data.sessions.length) return <Text dimColor>Нет сессий</Text>;
  return (
    <Box flexDirection="column">
      {data.sessions.map((s) => {
        const t = data.tokens.find((t) => t.sessionId === s.sessionId);
        return (
          <Text key={s.sessionId}>
            {s.sessionId.slice(0, 8)}  {s.profile.padEnd(12)} {t ? `${t.used}/${t.saved}` : "0/0"}
          </Text>
        );
      })}
    </Box>
  );
}
