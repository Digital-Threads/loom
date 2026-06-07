import React, { useState } from "react";
import { Box, Text } from "ink";
import { defaultDeps } from "../../core/install/runner.js";
import { buildCatalog } from "../../core/catalog/catalog.js";
import type { InstallDeps } from "../../core/install/types.js";
import type { CatalogItem } from "../../core/catalog/types.js";

const MARK = { installed: "✓", "not-installed": "○", "update-available": "↻" } as const;

export function CatalogPanel({ deps = defaultDeps() }: { deps?: InstallDeps }) {
  const [items] = useState<CatalogItem[]>(() => buildCatalog(deps));
  const [cursor] = useState(0);
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Text key={it.id} inverse={i === cursor}>
          {MARK[it.status]} {it.title}  [{it.category}]  {it.case}
          {it.status === "update-available" ? "  (есть обновление)" : ""}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ выбор · Enter — установить · u обновить · d удалить · e вкл/выкл</Text>
      </Box>
    </Box>
  );
}
