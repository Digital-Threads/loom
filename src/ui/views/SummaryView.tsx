import React from "react";
import { Box, Text } from "ink";
import type { SummaryView as SummaryViewSpec } from "../../core/plugins/types.js";
import { resolveBind, resolveFieldRef, type BindContext } from "../../core/views/resolve.js";

export function SummaryView({ spec, ctx }: { spec: SummaryViewSpec; ctx: BindContext }) {
  return (
    <Box flexDirection="column">
      {spec.lines.map((line, i) => {
        if (line.when && !resolveFieldRef(line.when, ctx)) return null;
        const value = resolveBind(line.value, ctx);
        return (
          <Text key={`${line.label}-${i}`} color={line.color}>
            {line.label}: {String(value ?? "—")}
          </Text>
        );
      })}
    </Box>
  );
}
