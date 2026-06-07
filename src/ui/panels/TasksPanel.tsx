import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { WorkspaceData } from "../../core/data/loader.js";
import { loomRegistry } from "../../core/plugins/index.js";
import { tokensForTask } from "../../core/metrics/tokens-per-task.js";
import { TaskDetail } from "./TaskDetail.js";

export function TasksPanel({ data }: { data: WorkspaceData }) {
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"close" | "metric" | null>(null);
  const [status, setStatus] = useState("");
  const tasks = data.tasks;

  useInput((input, key) => {
    if (openId) {
      if (confirm !== null) {
        if (input === "y") {
          const ctx = { projectRoot: process.cwd() };
          const tj = loomRegistry.get("task-journal");
          if (confirm === "close") {
            const action = tj?.actions?.find((a) => a.id === "closeTask");
            const res = action?.run(ctx, { taskId: openId, opts: { outcomeTag: "done" } });
            const ok = Boolean(res?.ok);
            setStatus(ok ? "задача закрыта (обновится при перезапуске)" : "ошибка закрытия");
          } else {
            const t = tokensForTask(data.taskEvents, openId, data.tokenEvents);
            const action = tj?.actions?.find((a) => a.id === "writeTokenMetric");
            const res = action?.run(ctx, { taskId: openId, tokens: t });
            const ok = Boolean(res?.ok);
            setStatus(
              ok
                ? `метрика записана: ${t.used}/${t.saved} (обновится при перезапуске)`
                : "ошибка записи метрики",
            );
          }
          setConfirm(null);
        } else if (input === "n" || key.escape) {
          setConfirm(null);
          setStatus("отмена");
        }
        return;
      }
      if (key.escape) {
        setOpenId(null);
        setStatus("");
      } else if (input === "c") {
        setConfirm("close");
      } else if (input === "t") {
        setConfirm("metric");
      }
      return;
    }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    else if (key.downArrow) setCursor((c) => Math.min(tasks.length - 1, c + 1));
    else if (key.return && tasks[cursor]) setOpenId(tasks[cursor].id);
  });

  if (!tasks.length) return <Text dimColor>Нет задач</Text>;

  if (openId) {
    const t = tasks.find((x) => x.id === openId);
    return (
      <TaskDetail
        events={data.taskEvents}
        id={openId}
        title={t?.title ?? ""}
        sessions={data.sessions}
        tokens={data.tokens}
        tokenEvents={data.tokenEvents}
        confirm={confirm}
        status={status}
      />
    );
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
