import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { loomRegistry } from "../../core/plugins/index.js";
import type { LoomContext, LoomPlugin, SettingField } from "../../core/plugins/types.js";

// source:"registry-settings" -- the host reads loomRegistry (NOT WorkspaceData).
// Logic ported from SettingsPanel (Task 7.3 -- temporary duplication is allowed,
// to be removed in 7.4 when App switches to ViewRenderer).

function getDotted(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function FormView() {
  const ctx: LoomContext = { projectRoot: process.cwd() };
  const list = loomRegistry.list();

  const editable = list.flatMap((p) =>
    (p.settings?.schema.fields ?? [])
      .filter(() => Boolean(p.settings))
      .map((field) => ({ plugin: p, field })),
  );

  const [selected, setSelected] = useState(0);
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [, setVersion] = useState(0);

  const entry = editable[selected];

  function display(value: unknown): string {
    if (value === undefined || value === null) return "—";
    return String(value);
  }

  function readValue(plugin: LoomPlugin, field: SettingField): unknown {
    if (!plugin.settings) return undefined;
    return getDotted(plugin.settings.read(ctx), field.key);
  }

  function save(plugin: LoomPlugin, field: SettingField, value: unknown) {
    const ok = plugin.settings!.write(ctx, { [field.key]: value });
    setStatus(ok ? `saved: ${field.key}=${String(value)}` : "write failed");
    setVersion((v) => v + 1);
  }

  useInput((input, key) => {
    if (editBuffer !== null) {
      if (key.escape) {
        setEditBuffer(null);
        setStatus("cancelled");
        return;
      }
      if (key.return) {
        if (editBuffer === "") {
          setEditBuffer(null);
          setStatus("cancelled");
          return;
        }
        const num = Number(editBuffer);
        if (Number.isNaN(num)) {
          setEditBuffer(null);
          setStatus("cancelled");
          return;
        }
        if (entry) save(entry.plugin, entry.field, num);
        setEditBuffer(null);
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((b) => (b ?? "").slice(0, -1));
        return;
      }
      if (/^[0-9]$/.test(input)) {
        setEditBuffer((b) => (b ?? "") + input);
      }
      return;
    }

    if (editable.length === 0) return;
    if (key.upArrow) {
      setSelected((s) => (s - 1 + editable.length) % editable.length);
      return;
    }
    if (key.downArrow) {
      setSelected((s) => (s + 1) % editable.length);
      return;
    }
    if (key.return) {
      if (!entry) return;
      const field = entry.field;
      const current = readValue(entry.plugin, field);
      if (field.readonly) {
        setStatus("read-only field: edit the settings file");
      } else if (field.type === "boolean") {
        save(entry.plugin, field, !current);
      } else if (field.type === "enum") {
        const options = field.options ?? [];
        if (options.length === 0) return;
        const idx = options.indexOf(String(current));
        const next = options[(idx + 1) % options.length];
        save(entry.plugin, field, next);
      } else if (field.type === "number") {
        setEditBuffer(current === undefined || current === null ? "" : String(current));
      } else {
        setStatus("string fields: edit the settings file");
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>

      {list.map((p) => {
        const fields = p.settings?.schema.fields ?? [];
        return (
          <Box key={p.id} flexDirection="column" marginTop={1}>
            <Text bold>{p.title}</Text>
            {fields.length === 0 ? (
              <Text dimColor>no configurable options (write via actions)</Text>
            ) : (
              fields.map((f) => {
                const idx = editable.findIndex(
                  (e) => e.plugin.id === p.id && e.field.key === f.key,
                );
                const isSelected = idx === selected;
                const editing = isSelected && editBuffer !== null;
                const valueText = editing ? `[${editBuffer}_]` : display(readValue(p, f));
                const prefix = isSelected ? "► " : "  ";
                return (
                  <Text key={f.key} inverse={isSelected && !editing}>
                    {prefix}
                    {f.label}: {valueText}
                  </Text>
                );
              })
            )}
          </Box>
        );
      })}

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          ↑/↓ select · Enter edit/toggle · digits+Enter number · Backspace · Escape cancel
        </Text>
        <Text dimColor>{status}</Text>
      </Box>
    </Box>
  );
}
