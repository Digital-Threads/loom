import React from "react";
import { Box, Text, useInput } from "ink";
import type { DoctorReport } from "../../core/doctor/types.js";
import type { PrereqReport } from "../../core/doctor/prereqs.js";

// Presentational Config tab (LP5): read-only doctor output (scope sections +
// collisions + prerequisites). Writing -- only via INJECTED callbacks
// (onApply/onDryRun -> runMerge); no business logic in the component.
export function ConfigView({ reports, prereq, onApply, onDryRun }: {
  reports: DoctorReport[];
  prereq: PrereqReport;
  onApply: () => void;
  onDryRun?: () => void;
}) {
  useInput((ch) => {
    if (ch === "a") onApply();
    if (ch === "d" && onDryRun) onDryRun();
  });
  return (
    <Box flexDirection="column">
      {reports.map((r) => (
        <Box key={r.scope} flexDirection="column">
          <Text>{r.ok ? "✓" : "✗"} {r.scope}{r.missingMcp.length ? `  · missing MCP: ${r.missingMcp.join(", ")}` : ""}{r.changedMcp.length ? `  · changed: ${r.changedMcp.join(", ")}` : ""}{r.missingHookEvents.length ? `  · missing hooks: ${r.missingHookEvents.join(", ")}` : ""}</Text>
          {r.hookCollisions.map((c, i) => (<Text key={i} dimColor>  ⚠ hook collision {c.event}: {c.plugins.join(", ")}</Text>))}
          {r.mcpCollisions.map((c, i) => (<Text key={i} dimColor>  ⚠ MCP collision {c.server}: {c.plugins.join(", ")}</Text>))}
        </Box>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text>Prerequisites:</Text>
        {prereq.tools.map((t) => (<Text key={t.name}>{t.found ? "✓" : "✗"} {t.name}{!t.found && t.hint ? ` — ${t.hint}` : ""}</Text>))}
      </Box>
      <Box marginTop={1}><Text dimColor>d — dry-run · a — apply merge (with backup)</Text></Box>
    </Box>
  );
}
