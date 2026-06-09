import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  installPlugin,
  planInstall,
  removePlugin,
} from "../../core/install/install.js";
import { readInstalled, setEnabled } from "../../core/install/registry-file.js";
import { defaultDeps } from "../../core/install/runner.js";
import { parseSource } from "../../cli/plugin-cli.js";
import type { InstallPlan, InstallSource } from "../../core/install/types.js";

// Host screen for managing installed plugins (Task 11.1).
// NOT a ViewSpec: text input + confirmed actions -> a separate Ink panel.
// Reads the registry itself via readInstalled(defaultDeps()).
//
// KNOWN LIMITATION: in addInput mode App's global hotkeys (q -- quit,
// left/right -- tab switching) stay active, because Ink offers no focus-capture.
// Typing the letter "q" goes to App-quit. Full focus management is a separate task.

interface PluginRow {
  name: string;
  version: string;
  enabled: boolean;
  source: string;
}

type Mode = "list" | "addInput" | "confirmRemove" | "confirmInstall";

function loadRows(): PluginRow[] {
  const reg = readInstalled(defaultDeps()).plugins;
  return Object.keys(reg)
    .sort()
    .map((name) => ({
      name,
      version: reg[name].version,
      enabled: reg[name].enabled,
      source: reg[name].source,
    }));
}

async function defaultPackAction(): Promise<string> {
  const { collectPackInput } = await import("../../core/pack/collect-pack.js");
  const { buildPack } = await import("../../core/pack/build-pack.js");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const input = await collectPackInput();
  const md = buildPack(input);
  const path = join(process.cwd(), "workspace-pack.md");
  writeFileSync(path, md, "utf8");
  return path;
}

export function PluginsPanel(
  { packAction = defaultPackAction }: { packAction?: () => Promise<string> } = {},
) {
  const [rows, setRows] = useState<PluginRow[]>(loadRows);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>("list");
  const [input, setInput] = useState(""); // source input buffer
  const [plan, setPlan] = useState<InstallPlan | null>(null); // plan for confirmInstall
  const [pendingSource, setPendingSource] = useState<InstallSource | null>(null); // source for install
  const [status, setStatus] = useState(""); // status/error line

  const reload = () => {
    const next = loadRows();
    setRows(next);
    setCursor((c) => Math.max(0, Math.min(c, next.length - 1)));
  };

  useInput((ch, key) => {
    // -- source text input mode ----------------------------------------------
    if (mode === "addInput") {
      if (key.escape) {
        setMode("list");
        setInput("");
        setStatus("");
        return;
      }
      if (key.return) {
        const buf = input.trim();
        setInput("");
        if (!buf) {
          setMode("list");
          return;
        }
        try {
          const source = parseSource(buf);
          const planned = planInstall(source, defaultDeps());
          if (!planned.ok || !planned.plan) {
            setStatus(`Error: ${planned.error ?? "failed to build plan"}`);
            setMode("list");
            return;
          }
          setPlan(planned.plan);
          setPendingSource(source);
          setMode("confirmInstall");
          setStatus("");
        } catch (err) {
          setStatus(`Error: ${(err as Error).message}`);
          setMode("list");
        }
        return;
      }
      if (key.backspace || key.delete) {
        setInput((s) => s.slice(0, -1));
        return;
      }
      // a normal printable character -- accumulate (ignore control ones)
      if (ch && !key.ctrl && !key.meta) {
        setInput((s) => s + ch);
      }
      return;
    }

    // -- install confirmation --------------------------------------------------
    if (mode === "confirmInstall") {
      if (ch === "y" || ch === "Y") {
        if (pendingSource && plan) {
          const res = installPlugin(pendingSource, defaultDeps(), () => true);
          setStatus(
            res.ok
              ? `✓ installed ${plan.name}@${plan.version}`
              : `Install error: ${res.error ?? "unknown"}`,
          );
        } else {
          setStatus("Error: no install plan");
        }
        setPlan(null);
        setPendingSource(null);
        setMode("list");
        reload();
        return;
      }
      if (ch === "n" || ch === "N" || key.escape) {
        setPlan(null);
        setPendingSource(null);
        setMode("list");
        setStatus("Install cancelled");
      }
      return;
    }

    // -- remove confirmation ---------------------------------------------------
    if (mode === "confirmRemove") {
      const row = rows[cursor];
      if ((ch === "y" || ch === "Y") && row) {
        const res = removePlugin(row.name, defaultDeps());
        setStatus(
          res.ok ? `✓ removed ${row.name}` : `Error: ${res.error ?? "failed to remove"}`,
        );
        setMode("list");
        reload();
        return;
      }
      if (ch === "n" || ch === "N" || key.escape) {
        setMode("list");
        setStatus("Removal cancelled");
      }
      return;
    }

    // -- list ------------------------------------------------------------------
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(rows.length - 1, c + 1));
      return;
    }
    if (ch === "a") {
      setMode("addInput");
      setInput("");
      setStatus("");
      return;
    }
    if (ch === "p") {
      packAction()
        .then((path) => setStatus(`pack written: ${path}`))
        .catch((e) => setStatus(`Pack error: ${(e as Error).message}`));
      return;
    }
    const row = rows[cursor];
    if (!row) return;
    if (ch === "e") {
      const res = setEnabled(defaultDeps(), row.name, !row.enabled);
      setStatus(
        res.ok
          ? `${row.name}: ${!row.enabled ? "enabled" : "disabled"} (updates on restart)`
          : `Error: ${res.error ?? "failed"}`,
      );
      reload();
      return;
    }
    if (ch === "d") {
      setMode("confirmRemove");
      setStatus("");
      return;
    }
  });

  return (
    <Box flexDirection="column">
      {mode === "list" && <ListView rows={rows} cursor={cursor} />}
      {mode === "addInput" && <AddInputView input={input} />}
      {mode === "confirmRemove" && <ConfirmRemoveView name={rows[cursor]?.name ?? ""} />}
      {mode === "confirmInstall" && <ConfirmInstallView plan={plan} />}

      {status ? (
        <Box marginTop={1}>
          <Text dimColor>{status}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>{footerFor(mode)}</Text>
      </Box>
    </Box>
  );
}

function ListView({ rows, cursor }: { rows: PluginRow[]; cursor: number }) {
  if (rows.length === 0) {
    return <Text dimColor>No plugins. a — add</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => {
        const dot = r.enabled ? "●" : "○";
        const flag = r.enabled ? "on" : "off";
        const line = `${dot} ${r.name}  v${r.version}  [${flag}]  ${r.source}`;
        return (
          <Text key={r.name} inverse={i === cursor}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function AddInputView({ input }: { input: string }) {
  return (
    <Box flexDirection="column">
      <Text>Plugin source (npm/git/local path):</Text>
      <Text>
        {"> "}
        {input}
        <Text inverse> </Text>
      </Text>
    </Box>
  );
}

function ConfirmRemoveView({ name }: { name: string }) {
  return <Text>Remove {name}? y/n</Text>;
}

function ConfirmInstallView({ plan }: { plan: InstallPlan | null }) {
  if (!plan) return <Text>No install plan</Text>;
  const perms = plan.permissions.length > 0 ? plan.permissions.join(", ") : "none";
  return (
    <Box flexDirection="column">
      <Text>
        Install {plan.name}@{plan.version}?
      </Text>
      <Text>Permissions: {perms}</Text>
      <Text>y/n</Text>
    </Box>
  );
}

function footerFor(mode: Mode): string {
  switch (mode) {
    case "addInput":
      return "Enter — continue · Esc — cancel";
    case "confirmRemove":
      return "y — remove · n/Esc — cancel";
    case "confirmInstall":
      return "y — install · n/Esc — cancel";
    default:
      return "↑/↓ select · e toggle · d remove · a add · p build pack";
  }
}
