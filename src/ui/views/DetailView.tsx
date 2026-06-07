import React from "react";
import { Box, Text } from "ink";
import type { DetailView as DetailViewSpec } from "../../core/plugins/types.js";
import { resolveBind, getDotted, type BindContext } from "../../core/views/resolve.js";

export function DetailView({
  spec,
  ctx,
  confirmKey = null,
  status = "",
}: {
  spec: DetailViewSpec;
  ctx: BindContext;
  confirmKey?: string | null;
  status?: string;
}) {
  const title = resolveBind(spec.title, ctx);
  const idParam = ctx.idParam ?? "";

  return (
    <Box flexDirection="column">
      <Text bold>{String(title || idParam)}</Text>
      <Text dimColor>{idParam}</Text>

      {spec.sections.map((sec) => {
        const items = (resolveBind(sec.items, ctx) as Record<string, unknown>[]) ?? [];
        return (
          <Box key={sec.label} flexDirection="column" marginTop={1}>
            <Text bold>
              {sec.label} ({items.length})
            </Text>
            {items.length === 0 ? (
              <Text dimColor>  {sec.empty ?? "—"}</Text>
            ) : (
              items.map((item, i) => (
                <Text key={i}>  • {String(getDotted(item, sec.itemText) ?? "")}</Text>
              ))
            )}
          </Box>
        );
      })}

      {spec.scalars && spec.scalars.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {spec.scalars.map((s, i) => (
            <Text key={`${s.label}-${i}`}>
              {s.label}: {String(resolveBind(s.value, ctx) ?? "—")}
            </Text>
          ))}
        </Box>
      )}

      {spec.actions && spec.actions.length > 0 && (
        <Text dimColor>
          {"\n"}
          {spec.actions.map((a) => `${a.key} — ${a.label ?? a.actionId}`).join(" · ")} · Esc — назад
        </Text>
      )}

      {confirmKey && <Text color="yellow">Подтвердить действие "{confirmKey}"? (y/n)</Text>}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
