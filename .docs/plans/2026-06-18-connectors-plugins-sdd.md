# SDD — Управление Claude-плагинами в разделе Connectors (loom-host)

## 1. Цель

В уже существующем разделе **Connectors** (`web/src/components/Connectors.tsx`, где сейчас
живут MCP-серверы и трекеры) добавить **секцию Plugins** — управление Claude-плагинами как
ещё одним видом коннектора. Это **не новый раздел**, а ещё один блок в той же панели.

Пользователь должен:
- видеть список установленных плагинов (имя / версия / статус on-off);
- установить новый плагин по строке `name@marketplace`;
- обновить / включить / выключить / удалить плагин;
- добавить marketplace и посмотреть список добавленных marketplace'ов.

Бэкенд-логика установки уже есть в `src/core/install/*` и переписываться **не должна**.
Новые HTTP-роуты — тонкие обёртки над тем же CLI `claude plugin …`, который сегодня гоняют
recipes (`synthesizeRecipeFromClaudePlugin`, `src/core/install/recipe.ts:116`), с тем же
анти-инъекционным хардненингом источника marketplace.

## 2. Границы (что НЕ делаем)

- Не трогаем `src/core/install/*` (пайплайн `planInstall` / `installPlugin` / `removePlugin`
  остаётся как есть; роуты его **не вызывают** — у него другой контракт, см. §5.1).
- Не создаём новый раздел/вкладку в UI — только новая секция внутри `Connectors.tsx`.
- Не меняем существующие MCP / tracker роуты, типы и тесты (только аддитивно).
- Не добавляем новых зависимостей, настроек, абстракций сверх задачи.
- UI строго на английском; строго дизайн-система (`check:ds`).

## 3. Затрагиваемые файлы

| Файл | Изменение |
| --- | --- |
| `src/web/api.ts` | Новый блок роутов `connectors: Plugins`, рядом с блоком MCP (D5, L1337). Новый инъектируемый dep в `ApiDeps`. |
| `web/src/api.ts` | Методы-обёртки в `createClient` (рядом с `mcpList`, L327) + типы. |
| `web/src/components/Connectors.tsx` | Новая секция Plugins (список + форма install + действия + add marketplace). |
| `src/core/install/install.ts` | **Только чтение** — переиспользуем exported `isValidMarketplaceSource` (L55). |
| `test/web/api.test.ts` | Тесты новых роутов (фейковый CLI-раннер через deps). |
| `web/src/components/Connectors.test.tsx` | Тесты UI новой секции (фейковый client). |

## 4. Контракты API

Новые роуты под префиксом `/api/connectors/plugins` и `/api/connectors/marketplaces`.
Каждый обработчик — в защитном `try/catch`; ошибка CLI возвращается как `{ ok:false, error }`
(или непустой `error` в теле), **никогда не роняет сервер**.

| Метод / путь | Тело | Ответ | Действие CLI |
| --- | --- | --- | --- |
| `GET /api/connectors/plugins` | — | `{ plugins: PluginEntry[] }` | `claude plugin list` (+ defensive parse) |
| `POST /api/connectors/plugins` | `{ name }` | `{ ok, error? }` | `claude plugin install -- <name>` |
| `POST /api/connectors/plugins/:name/update` | — | `{ ok, error? }` | `claude plugin update -- <name>` |
| `POST /api/connectors/plugins/:name/uninstall` | — | `{ ok, error? }` | `claude plugin uninstall -- <name>` |
| `POST /api/connectors/plugins/:name/enable` | — | `{ ok, error? }` | `claude plugin enable -- <name>` |
| `POST /api/connectors/plugins/:name/disable` | — | `{ ok, error? }` | `claude plugin disable -- <name>` |
| `GET /api/connectors/marketplaces` | — | `{ marketplaces: string[] }` | `claude plugin marketplace list` |
| `POST /api/connectors/marketplaces` | `{ source }` | `{ ok, error? }` | `claude plugin marketplace add -- <source>` |

Тип (зеркалится в `web/src/api.ts`):

```ts
interface PluginEntry { name: string; version?: string; enabled: boolean }
```

Методы клиента `createClient` (по образцу `mcpList`/`mcpAdd`):
`pluginList()`, `pluginInstall(name)`, `pluginUpdate(name)`, `pluginUninstall(name)`,
`pluginEnable(name)`, `pluginDisable(name)`, `marketplaceList()`, `marketplaceAdd(source)`.

## 5. Дизайн-решения

### 5.1 Тонкие обёртки над `claude`, а не `installPlugin`/`removePlugin`

Пайплайн `installPlugin` (`src/core/install/install.ts:253`) требует **Loom-манифест**
(`plugin.json`) и `InstallSource` (npm/git/local), а UI оперирует голым `name@marketplace`.
Поэтому роуты вызывают тот же `claude plugin …`, который пайплайн гоняет внутри recipes —
это и есть «обернуть, не переписывая». Хардненинг переиспользуем напрямую.

### 5.2 Инъектируемый CLI-раннер (testability + не блокировать loop)

В `ApiDeps` добавляем:

```ts
/** Run a `claude plugin …` CLI call (default: execFile "claude", args). Override for tests. */
claudePlugin?: (args: string[]) => Promise<{ code: number; stdout: string }>;
```

Дефолт — обёртка над существующим `realSh` (`src/web/api.ts:417`, async `execFile`, не
блокирует event loop; сетевые `marketplace add`/`install` именно поэтому async). Тесты
инжектят фейковый раннер и проверяют как переданные аргументы, так и парсинг вывода —
по образцу `mcpProbe` в `test/web/api.test.ts:272`.

### 5.3 Хардненинг аргументов (анти-инъекция)

- **marketplace add**: `source` проверяется exported `isValidMarketplaceSource`
  (`src/core/install/install.ts:55`) — запрещает флагоподобные строки, разрешает
  `https://…`, `owner/repo`, `./local`. Невалидный → `400 { error:"invalid source" }`,
  CLI не вызывается. Это тот же фильтр, что в `sanitizeSynthRecipe`.
- **install/update/…/`:name`**: защитный локальный guard в `api.ts` — отклоняем пустое и
  флагоподобное имя (начинается с `-`); допускаем `name` и `name@marketplace`
  (`[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?`). Невалидное → `400`.
- Все вызовы — через `execFile` (не shell) и с разделителем `--` перед пользовательским
  значением, поэтому shell- и флаг-инъекция исключены на уровне запуска.

### 5.4 Парсинг `claude plugin list`

Формат вывода CLI не гарантирован → парсер **толерантный и не бросает** (всё в `try/catch`,
при сбое возвращаем `{ plugins: [] }`). По строке: первый токен — `name`, токен, похожий на
версию (`/^v?\d+\./`), — `version`; статус `enabled` если строка содержит `enabled`/`on` и не
содержит `disabled`/`off`. Парсер изолирован в чистую функцию и покрыт юнит-тестом на
фиксированном тексте (фейковый раннер). **Открытый вопрос** — точный формат вывода
(см. §7); парсер написан так, чтобы пустой/неожиданный вывод давал пустой список, а не ошибку.

### 5.5 UI (секция Plugins в `Connectors.tsx`)

- Отдельный блок в той же `panel`: заголовок-нет (как у MCP — просто строка контролов +
  таблица), либо лёгкий разделитель в существующем стиле соседнего кода.
- Форма: `input` для `name@marketplace` + кнопка **Install**; `input` для marketplace
  `source` + кнопка **Add marketplace**.
- Таблица плагинов: столбцы Plugin (имя + чип on/off как у MCP-серверов), Version, действия
  **Update / Enable|Disable / Remove**.
- Список marketplace'ов — компактный список строк (read-only).
- Состояния: загрузка/пусто/ошибка через существующий `StateView`; успех/ошибка операций —
  через существующий `toast` (как в MCP-секции).
- Стиль строго как у соседнего кода: классы `inp`/`btn`/`btn acc`/`chip`/`tbl`, инлайн —
  только отступы (`gap`, `marginLeft`, `marginTop`); **без инлайн-цветов и без `fontSize`**
  (только `var(--fs-*)`, если шрифт вообще нужен) — `check:ds` остаётся зелёным.

## 6. План TDD

**Бэкенд (`test/web/api.test.ts`)** — фейковый `claudePlugin`-раннер:
1. `GET /api/connectors/plugins` парсит вывод раннера в `PluginEntry[]` (имя/версия/статус).
2. `POST /api/connectors/plugins` вызывает CLI с `["plugin","install","--","<name>"]`.
3. `update`/`uninstall`/`enable`/`disable` вызывают соответствующий CLI с `--` и именем.
4. Флагоподобное имя (`-x`) → `400`, CLI **не вызван**.
5. `POST /api/connectors/marketplaces` с валидным `owner/repo` → CLI `marketplace add`;
   с флагоподобным/битым `source` → `400`, CLI не вызван (reuse `isValidMarketplaceSource`).
6. `GET /api/connectors/marketplaces` парсит список.
7. Падение раннера (`code!=0` / исключение) → `{ ok:false, error }`, сервер не падает.

**UI (`web/src/components/Connectors.test.tsx`)** — фейковый `client`:
1. Рендерит список плагинов с чипом on/off и версией.
2. Install шлёт `pluginInstall(name)` и обновляет список.
3. Update/Enable/Disable/Remove дёргают нужный метод client.
4. Add marketplace шлёт `marketplaceAdd(source)`; список marketplace'ов рендерится.
5. Пустой список → `StateView empty`; ошибка → тост/`StateView error`.

## 7. Открытый вопрос / риск

- **Формат вывода `claude plugin list`** не зафиксирован. Митигация: толерантный парсер
  (§5.4), изолированный в чистую функцию и покрытый тестом; при неожиданном выводе —
  пустой список, не ошибка. Уточняется на этапе реализации/QA.
- **Таймаут**: дефолтный `realSh` без явного таймаута (в отличие от `defaultRun` 5s) —
  это сознательно, т.к. `marketplace add`/`install` сетевые и могут идти дольше 5s.

## 8. Критерии приёмки

- `bun run check:ds` (host) и `cd web && node scripts/check-design-system.mjs` — зелёные.
- `tsc -p tsconfig.json` (host) и `cd web && tsc --noEmit` — без ошибок.
- `vitest run` — новые тесты (бэкенд + UI) проходят; существующие не сломаны и не ослаблены.
- В UI Connectors видна секция Plugins; install/update/enable/disable/remove и add
  marketplace работают через новые роуты; ошибки CLI показываются, сервер не падает.
- `src/core/install/*` не изменён (кроме отсутствия изменений — только импорт guard'а).
