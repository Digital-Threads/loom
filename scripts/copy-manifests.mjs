// Копирует plugin.json builtin-плагинов в dist рядом со скомпилированными
// адаптерами. tsc сам JSON не копирует, а catalog.js импортирует манифесты
// через `import ... with { type: "json" }`, поэтому файлы должны быть в dist.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ids = ["aimux", "token-pilot", "task-journal"];

for (const id of ids) {
  const src = join(root, "src/core/plugins", id, "plugin.json");
  const dest = join(root, "dist/core/plugins", id, "plugin.json");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
