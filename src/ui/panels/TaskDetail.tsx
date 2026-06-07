import React from "react";
import { Box, Text } from "ink";
import { taskDetailFromEvents, type TjEvent } from "../../core/plugins/task-journal/adapter.js";

export function TaskDetail({ events, id, title }: { events: TjEvent[]; id: string; title: string }) {
  const detail = taskDetailFromEvents(events, id);
  const section = (label: string, items: TjEvent[]) => (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{label} ({items.length})</Text>
      {items.length === 0 ? (
        <Text dimColor>  —</Text>
      ) : (
        items.map((e) => (
          <Text key={e.event_id}>  • {e.text.replace(/\s+/g, " ").slice(0, 100)}</Text>
        ))
      )}
    </Box>
  );
  return (
    <Box flexDirection="column">
      <Text bold>{title || id}</Text>
      <Text dimColor>{id}</Text>
      {section("Решения", detail.decisions)}
      {section("Находки", detail.findings)}
      {section("Отвергнутое", detail.rejections)}
      <Text dimColor>{"\n"}Esc — назад к списку</Text>
    </Box>
  );
}
