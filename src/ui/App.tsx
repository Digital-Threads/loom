import React, { useState, useEffect } from "react";
import { homedir } from "node:os";
import { Box, Text, useInput, useApp } from "ink";
import { Tabs } from "./Tabs.js";
import { loadWorkspaceData, isWorkspaceEmpty, type WorkspaceData } from "../core/data/loader.js";
import { loomRegistry } from "../core/plugins/index.js";
import { ViewRenderer } from "./views/ViewRenderer.js";
import { PluginsPanel } from "./panels/PluginsPanel.js";
import { CatalogPanel } from "./panels/CatalogPanel.js";
import { ConfigView } from "./panels/ConfigView.js";
import { OnboardingPanel } from "./panels/OnboardingPanel.js";
import { overviewView, settingsView, tasksTokensView, timelineView } from "./views/host-views.js";
import { buildPluginTabs } from "../core/dashboard/layers.js";
import { diagnoseAll } from "../core/doctor/doctor.js";
import { runMerge } from "../core/doctor/apply.js";
import { checkPrerequisites } from "../core/doctor/prereqs.js";
import type { ScopeDirs, PluginContribution } from "../core/doctor/types.js";
import type { LoomPlugin, ViewSpec } from "../core/plugins/types.js";
import { InputModeContext } from "./input/InputModeContext.js";

// Plugin tabs grouped by layer (LAYER_ORDER order), not by registry (LP4).
// Layer order: accounts -> efficiency -> memory -> ... (see LAYER_ORDER in layers.ts).
// buildPluginTabs returns LayerTab[] with { pluginId, tabId, title }.
const pluginTabs = buildPluginTabs(loomRegistry.list());

// Order: Overview, Catalog, Tasks and tokens, Timeline, Config, [plugin tabs by layer], Settings, Plugins.
// "Catalog", "Tasks and tokens", "Timeline", "Config" and "Plugins" are host screens. "Catalog"/"Config"/"Plugins" are
// separate panels; "Tasks and tokens"/"Timeline" are cross-layer ViewSpecs (the same ViewRenderer).
const TABS = ["Overview", "Catalog", "Tasks & Tokens", "Timeline", "Config", ...pluginTabs.map((t) => t.title), "Settings", "Plugins"];

// Index of the catalog host tab (right after "Overview").
const CATALOG_TAB = 1;
// Index of the "Tasks and tokens" host tab (a cross-layer view, right after "Catalog").
const TASKS_TOKENS_TAB = 2;
// Index of the "Timeline" host tab (a cross-layer chronology, right after "Tasks and tokens").
const TIMELINE_TAB = 3;
// Index of the Config host tab (doctor + prerequisites), right after "Timeline".
const CONFIG_TAB = 4;
// Index of the plugin-management host tab (last).
const PLUGINS_TAB = TABS.length - 1;
// Index of the settings host tab (second to last).
const SETTINGS_TAB = TABS.length - 2;

// Mapping tab -> (plugin?, view-spec). 0 -> host overview; TASKS_TOKENS_TAB -> host tasks+tokens;
// TIMELINE_TAB -> host timeline; SETTINGS_TAB -> host settings; in between -- the corresponding plugin
// tab (plugin.views[tabId]).
// PLUGINS_TAB does NOT land here -- it is rendered as <PluginsPanel/> directly in App.
// Catalog of plugin contributions for the doctor tab. Empty [] for now (as in config-cli): formalizing
// the collection of PluginContribution from installed plugins is a separate task (LP later).
const configDirs: ScopeDirs = { homeDir: homedir(), projectDir: process.cwd() };
const configContributions: PluginContribution[] = [];

function tabView(active: number): { plugin?: LoomPlugin; spec: ViewSpec | ViewSpec[] } | null {
  if (active === 0) return { spec: overviewView };
  if (active === TASKS_TOKENS_TAB) return { spec: tasksTokensView };
  if (active === TIMELINE_TAB) return { spec: timelineView };
  if (active === SETTINGS_TAB) return { spec: settingsView };
  // Overview=0, Catalog=1, Tasks and tokens=2, Timeline=3, Config=4 -- plugin tabs from index 5.
  const entry = pluginTabs[active - 5];
  if (!entry) return null;
  const plugin = loomRegistry.get(entry.pluginId);
  const spec = plugin?.views?.[entry.tabId];
  return spec ? { plugin, spec } : null;
}

export function App() {
  const { exit } = useApp();
  const [active, setActive] = useState(0);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    loadWorkspaceData().then((d) => {
      setData(d);
      // Empty start: take the user straight to Catalog -- that's where plugins get installed.
      if (isWorkspaceEmpty(d)) setActive(CATALOG_TAB);
    });
  }, []);

  useInput((input, key) => {
    // In free-text input mode the global hotkeys stay silent (otherwise letters/'q'
    // would go here instead of the input field).
    if (capturing) return;
    if (input === "q") exit();
    if (key.rightArrow) setActive((a) => (a + 1) % TABS.length);
    if (key.leftArrow) setActive((a) => (a - 1 + TABS.length) % TABS.length);
    // loom-sns: direct tab selection via digits 1-9.
    if (/^[1-9]$/.test(input)) {
      const i = Number(input) - 1;
      if (i < TABS.length) setActive(i);
    }
  });

  const view = data === null ? null : tabView(active);

  return (
    <InputModeContext.Provider value={{ capturing, setCapturing }}>
    <Box flexDirection="column">
      <Tabs tabs={TABS} active={active} />
      <Box marginTop={1} flexDirection="column">
        {data === null ? (
          <Text dimColor>Loading…</Text>
        ) : active === 0 && isWorkspaceEmpty(data) ? (
          // Empty start: on "Overview" we show onboarding instead of zeros.
          // Other tabs (Plugins/Settings) work as usual -- you can still go there.
          <OnboardingPanel key={active} />
        ) : active === CATALOG_TAB ? (
          // Host screen of the plugin catalog -- not a ViewSpec. key={active} remounts the panel.
          <CatalogPanel key={active} />
        ) : active === CONFIG_TAB ? (
          // Host screen Config (doctor + prerequisites) -- not a ViewSpec. reports/prereq
          // are computed lazily on tab render (not on App mount). Writing only
          // via runMerge (onApply/onDryRun injection); the component is presentational.
          <ConfigView
            key={active}
            reports={diagnoseAll(configContributions, configDirs)}
            prereq={checkPrerequisites()}
            onApply={() => runMerge({ scope: "user", contributions: configContributions, dirs: configDirs, apply: true })}
            onDryRun={() => runMerge({ scope: "user", contributions: configContributions, dirs: configDirs, apply: false })}
          />
        ) : active === PLUGINS_TAB ? (
          // Host screen for plugin management -- not a ViewSpec. key={active} remounts the panel.
          <PluginsPanel key={active} />
        ) : view ? (
          // key={active} -> switching tabs remounts ViewRenderer (resets stack/cursor).
          <ViewRenderer key={active} plugin={view.plugin} spec={view.spec} data={data} />
        ) : (
          <Text dimColor>No data</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>←/→ or 1-9 tabs · q quit</Text>
      </Box>
    </Box>
    </InputModeContext.Provider>
  );
}
