import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";
import { TaskDetail } from "./TaskDetail.js";

export function TasksPanel({ data }: { data: WorkspaceData }) {
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const tasks = data.tasks;

  useInput((input, key) => {
    if (openId) {
      if (key.escape) setOpenId(null);
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(tasks.length - 1, c + 1));
    else if (key.return && tasks[cursor]) setOpenId(tasks[cursor].id);
  });

  if (!tasks.length) return <Text dimColor>Нет задач</Text>;

  if (openId) {
    const t = tasks.find((x) => x.id === openId);
    return <TaskDetail events={data.taskEvents} id={openId} title={t?.title ?? ""} />;
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>↑/↓ — выбрать · Enter — открыть</Text>
      {tasks.map((t, i) => (
        <Text key={t.id} inverse={i === cursor}>
          {t.status === "closed" ? "✓" : "○"} {t.title.slice(0, 60)}  <Text dimColor>{t.id}</Text>
        </Text>
      ))}
    </Box>
  );
}
