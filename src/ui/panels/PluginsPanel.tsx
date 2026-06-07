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

// Host-экран управления установленными плагинами (Task 11.1).
// НЕ ViewSpec: текстовый ввод + действия с подтверждением → отдельная Ink-панель.
// Читает реестр сам через readInstalled(defaultDeps()).
//
// ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: в режиме addInput глобальные хоткеи App (q — выход,
// ←/→ — переключение вкладок) остаются активны, т.к. Ink не даёт focus-capture.
// Ввод буквы "q" уйдёт в App-quit. Полноценный фокус-менеджмент — отдельная задача.

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
  const [input, setInput] = useState(""); // буфер ввода source
  const [plan, setPlan] = useState<InstallPlan | null>(null); // план для confirmInstall
  const [pendingSource, setPendingSource] = useState<InstallSource | null>(null); // источник для установки
  const [status, setStatus] = useState(""); // строка статуса/ошибки

  const reload = () => {
    const next = loadRows();
    setRows(next);
    setCursor((c) => Math.max(0, Math.min(c, next.length - 1)));
  };

  useInput((ch, key) => {
    // ── режим текстового ввода source ──────────────────────────────────────
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
            setStatus(`Ошибка: ${planned.error ?? "не удалось построить план"}`);
            setMode("list");
            return;
          }
          setPlan(planned.plan);
          setPendingSource(source);
          setMode("confirmInstall");
          setStatus("");
        } catch (err) {
          setStatus(`Ошибка: ${(err as Error).message}`);
          setMode("list");
        }
        return;
      }
      if (key.backspace || key.delete) {
        setInput((s) => s.slice(0, -1));
        return;
      }
      // обычный печатный символ — накапливаем (игнорируем управляющие)
      if (ch && !key.ctrl && !key.meta) {
        setInput((s) => s + ch);
      }
      return;
    }

    // ── подтверждение установки ────────────────────────────────────────────
    if (mode === "confirmInstall") {
      if (ch === "y" || ch === "Y") {
        if (pendingSource && plan) {
          const res = installPlugin(pendingSource, defaultDeps(), () => true);
          setStatus(
            res.ok
              ? `✓ установлен ${plan.name}@${plan.version}`
              : `Ошибка установки: ${res.error ?? "неизвестно"}`,
          );
        } else {
          setStatus("Ошибка: нет плана установки");
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
        setStatus("Установка отменена");
      }
      return;
    }

    // ── подтверждение удаления ─────────────────────────────────────────────
    if (mode === "confirmRemove") {
      const row = rows[cursor];
      if ((ch === "y" || ch === "Y") && row) {
        const res = removePlugin(row.name, defaultDeps());
        setStatus(
          res.ok ? `✓ удалён ${row.name}` : `Ошибка: ${res.error ?? "не удалось удалить"}`,
        );
        setMode("list");
        reload();
        return;
      }
      if (ch === "n" || ch === "N" || key.escape) {
        setMode("list");
        setStatus("Удаление отменено");
      }
      return;
    }

    // ── список ──────────────────────────────────────────────────────────────
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
        .then((path) => setStatus(`pack записан: ${path}`))
        .catch((e) => setStatus(`Ошибка pack: ${(e as Error).message}`));
      return;
    }
    const row = rows[cursor];
    if (!row) return;
    if (ch === "e") {
      const res = setEnabled(defaultDeps(), row.name, !row.enabled);
      setStatus(
        res.ok
          ? `${row.name}: ${!row.enabled ? "включён" : "выключен"} (обновится при перезапуске)`
          : `Ошибка: ${res.error ?? "не удалось"}`,
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
    return <Text dimColor>Плагинов нет. a — добавить</Text>;
  }
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => {
        const dot = r.enabled ? "●" : "○";
        const flag = r.enabled ? "вкл" : "выкл";
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
      <Text>Источник плагина (npm/git/локальный путь):</Text>
      <Text>
        {"> "}
        {input}
        <Text inverse> </Text>
      </Text>
    </Box>
  );
}

function ConfirmRemoveView({ name }: { name: string }) {
  return <Text>Удалить {name}? y/n</Text>;
}

function ConfirmInstallView({ plan }: { plan: InstallPlan | null }) {
  if (!plan) return <Text>Нет плана установки</Text>;
  const perms = plan.permissions.length > 0 ? plan.permissions.join(", ") : "нет";
  return (
    <Box flexDirection="column">
      <Text>
        Установить {plan.name}@{plan.version}?
      </Text>
      <Text>Доступы: {perms}</Text>
      <Text>y/n</Text>
    </Box>
  );
}

function footerFor(mode: Mode): string {
  switch (mode) {
    case "addInput":
      return "Enter — продолжить · Esc — отмена";
    case "confirmRemove":
      return "y — удалить · n/Esc — отмена";
    case "confirmInstall":
      return "y — установить · n/Esc — отмена";
    default:
      return "↑/↓ выбор · e вкл/выкл · d удалить · a добавить · p собрать pack";
  }
}
