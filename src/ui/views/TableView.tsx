import React from "react";
import { Box, Text } from "ink";
import type { Column, TableView as TableViewSpec } from "../../core/plugins/types.js";
import { resolveBind, getDotted, type BindContext } from "../../core/views/resolve.js";

function cellText(col: Column, row: Record<string, unknown>): string {
  let text = "";
  if (col.marker) {
    const raw = getDotted(row, col.marker.when);
    const on = col.marker.equals !== undefined ? raw === col.marker.equals : Boolean(raw);
    text += (on ? col.marker.truthy : (col.marker.falsy ?? " ")) + " ";
  }
  const raw = getDotted(row, col.value);
  let value = raw === undefined || raw === null ? "" : String(raw);
  if (col.width) {
    value = col.align === "right" ? value.padStart(col.width) : value.padEnd(col.width);
  }
  return text + value;
}

export function TableView({
  spec,
  ctx,
  cursor = -1,
}: {
  spec: TableViewSpec;
  ctx: BindContext;
  cursor?: number;
}) {
  const rows = (resolveBind(spec.source, ctx) as Record<string, unknown>[]) ?? [];
  const hasHeader = spec.columns.some((c) => c.header);
  const sep = " ".repeat(spec.gap ?? 2);

  if (rows.length === 0) {
    return <Text dimColor>{spec.empty ?? "Нет данных"}</Text>;
  }

  return (
    <Box flexDirection="column">
      {spec.selectable && <Text dimColor>↑/↓ — выбрать · Enter — открыть</Text>}
      {hasHeader && (
        <Text bold>
          {spec.columns
            .map((c) => {
              const h = c.header ?? "";
              if (!c.width) return h;
              return c.align === "right" ? h.padStart(c.width) : h.padEnd(c.width);
            })
            .join(sep)}
        </Text>
      )}
      {rows.map((row, i) => {
        const key = String(getDotted(row, spec.rowKey) ?? i);
        const line = spec.columns.map((c) => cellText(c, row)).join(sep);
        return (
          <Text key={key} inverse={spec.selectable && i === cursor}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
