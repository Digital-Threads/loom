import React from "react";
import { Box, Text } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";

export function SubscriptionsPanel({ data }: { data: WorkspaceData }) {
  if (!data.subscriptions.length) return <Text dimColor>Нет подписок</Text>;
  return (
    <Box flexDirection="column">
      {data.subscriptions.map((s) => (
        <Text key={s.name}>
          {s.isSource ? "★" : " "} {s.name.padEnd(14)} {s.cli}
        </Text>
      ))}
    </Box>
  );
}
