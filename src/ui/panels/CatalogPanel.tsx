import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { defaultDeps } from "../../core/install/runner.js";
import { buildCatalog, applyLatest, detectLatest } from "../../core/catalog/catalog.js";
import { runRecipe } from "../../core/install/recipe.js";
import { setEnabled } from "../../core/install/registry-file.js";
import { loomRegistry } from "../../core/plugins/index.js";
import type { InstallDeps } from "../../core/install/types.js";
import type { CatalogItem } from "../../core/catalog/types.js";
import { TextInput } from "../input/TextInput.js";
import { parseSource } from "../../cli/plugin-cli.js";
import { installPlugin } from "../../core/install/install.js";

const MARK = { installed: "✓", "not-installed": "○", "update-available": "↻" } as const;

type Mode = "list" | "confirmInstall" | "confirmRemove" | "search" | "addSource";

// Порядок слоёв = порядок ключей реестра (порядок регистрации, LP1).
// Явный потребитель groupByCategory(), чтобы метод LP1 не был мёртвым кодом.
const layerOrder = [...loomRegistry.groupByCategory().keys()];

// Стабильно сортируем плоский items[] по позиции category в порядке реестра.
// Группировка — только визуальная: cursor индексирует ЭТОТ же плоский массив,
// поэтому ↑/↓ и действия (Task 4/4.5) продолжают работать по плоскому порядку.
function orderByLayer(items: CatalogItem[]): CatalogItem[] {
  const pos = (c: string) => {
    const i = layerOrder.indexOf(c);
    return i === -1 ? layerOrder.length : i;
  };
  return [...items].sort((a, b) => pos(a.category) - pos(b.category));
}

export function CatalogPanel({ deps = defaultDeps() }: { deps?: InstallDeps }) {
  const [items, setItems] = useState<CatalogItem[]>(() => orderByLayer(buildCatalog(deps)));
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>("list");
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(true);
  const [query, setQuery] = useState("");

  const visible = query
    ? items.filter((it) =>
        [it.title, it.case, it.category].some((s) =>
          s.toLowerCase().includes(query.toLowerCase()),
        ),
      )
    : items;

  const reload = () => {
    const next = orderByLayer(buildCatalog(deps));
    setItems(next);
    setCursor((c) => Math.max(0, Math.min(c, next.length - 1)));
    setChecking(true);
  };

  // Ленивый сетевой детект latest: fast-рендер уже показал installed/version,
  // здесь догоняем update-available, не блокируя первый кадр.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      const latestById = new Map<string, string | undefined>();
      for (const it of items) {
        if (it.status === "not-installed") continue;
        latestById.set(it.id, detectLatest(it, deps));
      }
      if (cancelled) return;
      setItems((cur) => cur.map((it) => applyLatest(it, latestById.get(it.id))));
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);

  useInput((ch, key) => {
    if (mode === "search" || mode === "addSource") return;
    const item = visible[cursor];
    if (!item) return;

    if (mode === "confirmInstall") {
      if (ch === "y" || ch === "Y") {
        const res = runRecipe(item.recipe.install, { scope: "user" }, deps);
        setStatus(res.ok ? `✓ установлен ${item.id}` : `Ошибка: ${res.error}`);
        setMode("list");
        reload();
        return;
      }
      if (ch === "n" || ch === "N" || key.escape) {
        setMode("list");
        setStatus("Отменено");
      }
      return;
    }

    if (mode === "confirmRemove") {
      if (ch === "y" || ch === "Y") {
        const res = runRecipe(item.recipe.remove, { scope: "user" }, deps);
        setStatus(res.ok ? `Удалён ${item.id}` : `Ошибка: ${res.error}`);
        setMode("list");
        reload();
        return;
      }
      if (ch === "n" || ch === "N" || key.escape) {
        setMode("list");
        setStatus("Отменено");
      }
      return;
    }

    // list
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(visible.length - 1, c + 1));
      return;
    }
    if (key.return || ch === "i") {
      if (item.status === "not-installed") setMode("confirmInstall");
      return;
    }
    if (ch === "u") {
      if (item.status === "update-available") setMode("confirmInstall");
      return;
    }
    if (ch === "d") {
      if (item.status !== "not-installed") setMode("confirmRemove");
      return;
    }
    if (ch === "e") {
      if (item.status !== "not-installed") {
        setEnabled(deps, item.id, !item.enabled);
        reload();
      }
      return;
    }
    if (ch === "/") {
      setMode("search");
      return;
    }
    if (ch === "a") {
      setStatus("");
      setMode("addSource");
      return;
    }
  });

  const current = visible[cursor];

  return (
    <Box flexDirection="column">
      {visible.map((it, i) => {
        const loading = checking && it.status !== "not-installed" && !it.latestVersion;
        const tail =
          it.status === "update-available"
            ? "  ↻ есть обновление"
            : loading
              ? "  ↻… проверка обновлений"
              : "";
        // Заголовок слоя — отдельной строкой перед сменой category (визуальная секция).
        const isFirstOfLayer = i === 0 || visible[i - 1].category !== it.category;
        return (
          <React.Fragment key={it.id}>
            {isFirstOfLayer ? (
              <Text bold color="cyan">
                — {it.category} —
              </Text>
            ) : null}
            <Text inverse={i === cursor}>
              {MARK[it.status]} {it.title}  {it.case}
              {tail}
            </Text>
          </React.Fragment>
        );
      })}

      {mode === "search" ? (
        <Box marginTop={1}>
          <Text>/ </Text>
          <TextInput
            initial={query}
            placeholder="поиск по каталогу…"
            onChange={(v) => {
              setQuery(v);
              setCursor(0);
            }}
            onSubmit={() => setMode("list")}
            onCancel={() => {
              setQuery("");
              setCursor(0);
              setMode("list");
            }}
          />
        </Box>
      ) : null}
      {mode === "addSource" ? (
        <Box marginTop={1}>
          <Text>source: </Text>
          <TextInput
            placeholder="npm-имя / github:owner/repo / путь"
            onSubmit={(src) => {
              const s = src.trim();
              if (s) {
                const res = installPlugin(parseSource(s), deps);
                setStatus(
                  res.ok
                    ? `✓ установлен ${res.plan?.name ?? s}`
                    : `Ошибка: ${res.error ?? "не удалось"}`,
                );
                reload();
              }
              setMode("list");
            }}
            onCancel={() => setMode("list")}
          />
        </Box>
      ) : null}

      {mode === "confirmInstall" && current ? (
        <Box marginTop={1}>
          <Text>
            {current.status === "update-available" ? "Обновить" : "Установить"} {current.id}? (y/n)
          </Text>
        </Box>
      ) : null}
      {mode === "confirmRemove" && current ? (
        <Box marginTop={1}>
          <Text>Удалить {current.id}? (y/n)</Text>
        </Box>
      ) : null}

      {status ? (
        <Box marginTop={1}>
          <Text dimColor>{status}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>✓ установлен · ○ нет · ↻ обновление</Text>
      </Box>
      <Box>
        <Text dimColor>↑/↓ выбор · Enter — установить · u обновить · d удалить · e вкл/выкл · / поиск · a source</Text>
      </Box>
    </Box>
  );
}
