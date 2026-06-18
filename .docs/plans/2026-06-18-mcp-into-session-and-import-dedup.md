# SDD + R&D — MCP-серверы в сессию агента + дедуп импорта трекера (только loom-host)

- Дата: 2026-06-18
- Задача журнала: tj-y89ekajpe2
- External: loom:t-c3225503
- Класс: feature (+ прицепной bug-fix)
- Ограничение: правим **только loom-host**; сам `aimux` НЕ трогаем (только публичный `buildRunParams`). Аддитивно для общего кода. UI english. Дизайн-система (`npm run check:ds` зелёный). TDD где тестируемо.

---

## 1. Проблема

### 1.1 Главный gap — MCP не доходит до агента
Пользователь добавляет MCP-сервер в реестр (`~/.loom/mcp.json`). Этот список читается
ТОЛЬКО в GET `/api/connectors/mcp` (`src/web/api.ts:1309`) и в `testMcp`. В сессию
агента он **не передаётся**: лаунчер `aimux-session-launcher.ts` про `listMcp()` не знает.
→ реестр косметический.

**Подтверждено чтением кода:**
- `listMcp()` определён в `src/core/connectors/mcp.ts:38`; тип `McpServer = { id, command, args?, enabled }`.
- Лаунчер собирает аргументы запуска так:
  `build(cfg, profile, { model, extraArgs: [...STREAM_FLAGS, ...ENFORCE_FLAGS, ...permArgs, ...sessionArgs] })`
  (`createAimuxLiveLauncher` → `spawnSession`).
- token-pilot подключается отдельным флагом: `ENFORCE_FLAGS = ["--settings", enforcedSettingsPath()]`
  (`aimux-session-launcher.ts:33`). Флаг `--mcp-config` независим от `--settings` → их можно
  сосуществовать, инъекция token-pilot не ломается.

### 1.2 Прицепной баг — повторный импорт плодит дубли
`POST /api/connectors/import` (`src/web/api.ts:1324-1334`) на каждый вызов проходит по
черновикам и создаёт новые задачи со случайным id (`t-${randomUUID().slice(0,8)}`).
Импортировал дважды — получил дубли.

**Подтверждено:**
- `TaskDraft` (`src/core/connectors/connector.ts`) = `{ title, description? }` — нет внешнего ключа.
- `beadsConnector` (`src/core/connectors/beads.ts`) читает `bd list --json`, но `issue.id` **теряет**.
- Таблица `tasks` (`schema.ts`) не имеет колонки внешнего ключа, НО есть аддитивный механизм
  `ENSURE_COLUMNS` (`db.ts:45`) — добавляет недостающие колонки идемпотентно, без version-chain.

---

## 2. Цели и не-цели

**Цели**
1. Включённые (`enabled`) MCP-серверы из `listMcp()` реально попадают в процесс агента
   через `--mcp-config`.
2. Инъекция token-pilot через `--settings` остаётся нетронутой.
3. Повторный импорт из трекера не создаёт дубликаты — идемпотентность по внешнему ключу issue.

**Не-цели**
- OAuth/секреты для MCP, UI-редактирование MCP-конфига (за рамками).
- Менять `aimux`, формат `~/.loom/mcp.json`, поведение при пустом списке MCP.
- Ретро-дедуп уже созданных дублей (только предотвращение новых).

---

## 3. Решение

### 3.1 MCP → сессия (файловый конфиг)
- В `mcp.ts`: `mcpRunConfig(servers)` — чистый сборщик: только enabled + валидный
  (непустая строка) `command`, `args` фильтруются до строк; возвращает
  `{ mcpServers: { [id]: { command, args? } } }` или `null`, если нечего добавлять.
- В `mcp.ts`: `writeMcpRunConfig(servers, file?)` — пишет конфиг в файл
  (`~/.loom/mcp.run.json`) и возвращает путь, либо `null`.
- В `AimuxLiveLauncherDeps`: инъектируемые `listMcp` и `writeMcpRunConfig` (default — реальные).
- В `spawnSession`: `const path = writeMcp(listMcp())`; если путь есть →
  `["--mcp-config", path]` **после** `ENFORCE_FLAGS` (best-effort, ошибка записи не валит сессию).

**Почему файл, а не инлайн-JSON (пересмотрено после ревью):** файл (а) не упирается в
лимит длины argv (ARG_MAX/E2BIG) при большом реестре — иначе падал бы весь spawn, включая
token-pilot; (б) работает независимо от того, принимает ли CLI инлайн-JSON. Поля реестра
валидируются в `mcpRunConfig`, т.к. `~/.loom/mcp.json` редактируем вручную.

### 3.2 Дедуп импорта
- `TaskDraft` += необязательное поле `externalId?: string` (аддитивно).
- `beadsConnector.import()`: заполнять `externalId` из `issue.id` (`id`/`issue_id`/`ref` — что есть).
- Колонка `tasks.external_ref TEXT` через `ENSURE_COLUMNS` (db.ts).
- `CreateTaskInput` += `externalRef?: string`; `createTask` пишет его в INSERT.
- Новый helper `findTaskByExternalRef(db, ref): TaskRow | undefined`.
- Эндпоинт import: для каждого черновика с `externalId`, если `findTaskByExternalRef` нашёл —
  пропустить; иначе создать с `externalRef`. Ответ `{ created, skipped }` (поле `skipped` аддитивно;
  старые тесты на `created` не ломаются). Черновики без `externalId` создаются как раньше.

---

## 4. Затрагиваемые файлы
- `src/core/connectors/mcp.ts` — экспорт типа `McpServer` уже есть; функция чистая.
- `src/core/automation/aimux-session-launcher.ts` — инъекция listMcp + сборка `--mcp-config`.
- `src/core/connectors/connector.ts` — `TaskDraft.externalId?`.
- `src/core/connectors/beads.ts` — заполнять `externalId`.
- `src/core/store/schema.ts` или `db.ts` — `ENSURE_COLUMNS.tasks += external_ref`.
- `src/core/store/db.ts` — `CreateTaskInput.externalRef`, INSERT, `findTaskByExternalRef`.
- `src/web/api.ts` — import-эндпоинт: skip по external ref, ответ `{created, skipped}`.

## 5. Тесты (TDD)
- Лаунчер: при enabled-серверах `extraArgs` содержит `--mcp-config` с корректным JSON; при пустом — нет.
- `beadsConnector`: `externalId` берётся из issue.id.
- `db`: `createTask` с `externalRef` + `findTaskByExternalRef` находит.
- api `/api/connectors/import`: повторный импорт тех же драфтов → `created` второй раз 0, `skipped` > 0.

## 6. Риски / открытые вопросы
- Формат `--mcp-config`: `claude` принимает JSON-строку (подтвердить запуском на impl).
- Поле id у `bd list --json` — уточнить ключ (`id`) чтением реального вывода/теста beads на impl.
