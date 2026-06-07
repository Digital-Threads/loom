import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  settingsSchema as tpSchema,
  readSettings,
  settingValue,
  writeSettings,
} from "../../core/plugins/token-pilot/adapter.js";
import { settingsSchema as aimuxSchema } from "../../core/plugins/aimux/adapter.js";
import { settingsSchema as tjSchema } from "../../core/plugins/task-journal/adapter.js";

export function SettingsPanel() {
  const cwd = process.cwd();
  const tpFields = tpSchema().fields;
  const aimuxFields = aimuxSchema().fields;
  const tjFields = tjSchema().fields;

  const [selected, setSelected] = useState(0);
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // bump to force re-read after writes
  const [, setVersion] = useState(0);

  const field = tpFields[selected];

  function display(value: unknown): string {
    if (value === undefined || value === null) return "—";
    return String(value);
  }

  function save(key: string, value: unknown) {
    const ok = writeSettings(cwd, { [key]: value });
    setStatus(ok ? `сохранено: ${key}=${String(value)}` : "ошибка записи");
    setVersion((v) => v + 1);
  }

  useInput((input, key) => {
    if (editBuffer !== null) {
      // number-input mode
      if (key.escape) {
        setEditBuffer(null);
        setStatus("отмена");
        return;
      }
      if (key.return) {
        if (editBuffer === "") {
          setEditBuffer(null);
          setStatus("отмена");
          return;
        }
        const num = Number(editBuffer);
        if (Number.isNaN(num)) {
          setEditBuffer(null);
          setStatus("отмена");
          return;
        }
        save(field.key, num);
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

    // navigation mode
    if (key.upArrow) {
      setSelected((s) => (s - 1 + tpFields.length) % tpFields.length);
      return;
    }
    if (key.downArrow) {
      setSelected((s) => (s + 1) % tpFields.length);
      return;
    }
    if (key.return) {
      const current = settingValue(cwd, field.key);
      if (field.type === "boolean") {
        save(field.key, !current);
      } else if (field.type === "enum") {
        const options = field.options ?? [];
        if (options.length === 0) return;
        const idx = options.indexOf(String(current));
        const next = options[(idx + 1) % options.length];
        save(field.key, next);
      } else if (field.type === "number") {
        setEditBuffer(current === undefined || current === null ? "" : String(current));
      } else {
        setStatus("строковые поля: правьте .token-pilot.json");
      }
    }
  });

  // read fresh on each render
  readSettings(cwd);

  return (
    <Box flexDirection="column">
      <Text bold>Настройки</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>token-pilot</Text>
        {tpFields.map((f, i) => {
          const isSelected = i === selected;
          const editing = isSelected && editBuffer !== null;
          const valueText = editing
            ? `[${editBuffer}_]`
            : display(settingValue(cwd, f.key));
          const prefix = isSelected ? "► " : "  ";
          return (
            <Text key={f.key} inverse={isSelected && !editing}>
              {prefix}
              {f.label}: {valueText}
            </Text>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>aimux</Text>
        {aimuxFields.length === 0 ? (
          <Text dimColor>нет настраиваемых параметров (запись через действия)</Text>
        ) : (
          aimuxFields.map((f) => <Text key={f.key}>{f.label}</Text>)
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>task-journal</Text>
        {tjFields.length === 0 ? (
          <Text dimColor>нет настраиваемых параметров (запись через действия)</Text>
        ) : (
          tjFields.map((f) => <Text key={f.key}>{f.label}</Text>)
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          ↑/↓ выбор · Enter изменить/toggle · цифры+Enter число · Backspace · Escape отмена
        </Text>
        <Text dimColor>{status}</Text>
      </Box>
    </Box>
  );
}
