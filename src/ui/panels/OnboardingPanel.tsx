import React from "react";
import { Box, Text } from "ink";

// Presentational empty-start screen (Phase 11.2).
// Shown on the "Overview" tab when isWorkspaceEmpty(data) === true:
// no plugin returned data, and zeros in the summary tell a person nothing.
export function OnboardingPanel() {
  return (
    <Box flexDirection="column">
      <Text bold>Welcome to Loom</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Loom is a single dashboard for your tools (aimux, token-pilot,
          task-journal and more).
        </Text>
        <Text dimColor>
          No data yet — no plugin is reporting anything.
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Getting started</Text>
        <Text>· ← Open the Catalog tab: pick a plugin, Enter to install.</Text>
        <Text>· Or from the terminal: loom plugin add &lt;npm-package|path&gt;</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Built-in aimux / token-pilot / task-journal will show up here once
          they have data — run them in your project.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>←/→ tabs · q quit</Text>
      </Box>
    </Box>
  );
}
