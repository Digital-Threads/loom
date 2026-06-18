# SDD — Connectors: реестр трекеров + селектор в UI + GitHub Issues коннектор

- **Дата:** 2026-06-18
- **Область:** только `loom-host`
- **Класс:** feature
- **Задача (журнал):** tj-q3frae64hb

## 1. Цель

Сейчас импорт задач с внешнего трекера умеет один источник — **beads** (`bd`),
и он жёстко вшит в рантайм (`claude-runtime.ts:37`:
`importDrafts: () => beadsConnector().import()`). Кнопка в UI называется
«Import from beads».

Нужно превратить один захардкоженный коннектор в **набор коннекторов с выбором**:

1. **Реестр коннекторов** в ядре (минимум `beads` + `github`).
2. **Селектор коннектора** в `Connectors.tsx` — пользователь выбирает, откуда импортировать.
3. **Реальный коннектор GitHub Issues** — импорт открытых issues репозитория в задачи
   борда через `gh` CLI, с **идемпотентностью** (повторный импорт не плодит дубли).

beads должен продолжать работать без изменений поведения.

## 2. Не-цели (out of scope)

- Двусторонняя синхронизация / экспорт задач обратно в трекер.
- Импорт закрытых issues, pull requests, комментариев, лейблов, исполнителей.
- Хранение GitHub-токена в Loom (полагаемся на уже авторизованный `gh`).
- Периодический / автоматический импорт (только по кнопке, как сейчас).
- Любые изменения вне `loom-host`.

## 3. Текущее состояние (факты из кода)

- `src/core/connectors/connector.ts` — контракт:
  `Connector { id: string; import(): TaskDraft[] }`,
  `TaskDraft { title: string; description?: string; externalId?: string }`.
- `src/core/connectors/beads.ts` — `beadsConnector({ run? })`: эталонный коннектор,
  `bd list --status=open --json`, защитно `try/catch → []`, `externalId = issue.id`.
- `src/core/runtime/agent-runtime.ts` — интерфейс
  `ConnectorsProvider { listMcp(): McpServer[]; importDrafts(): TaskDraft[] }`.
- `src/core/runtime/claude-runtime.ts:37` — хардкод
  `importDrafts: () => beadsConnector().import()`.
- `src/web/api.ts`:
  - `deps.importDrafts?: () => TaskDraft[]` (`:132`) — точка подмены в тестах.
  - `POST /api/connectors/import` (`:1375`) — вызывает `importDrafts()`, **дедуп уже
    реализован здесь** через `findTaskByExternalRef(db, ref)` (`:1387`); по
    `externalId` пропускает уже импортированное, считает `{ created, skipped }`.
- `web/src/api.ts:341` — клиент `importTracker(): Promise<{ created: number }>`,
  шлёт `POST /api/connectors/import` с пустым телом.
- `web/src/components/Connectors.tsx` — кнопка «Import from beads» → `client.importTracker()`,
  результат показывается чипами (Importing… / Imported N / Nothing new to import / ошибка).
- Проверки CI: `check:ds` (`web/scripts/check-design-system.mjs`, `fontSize` только
  через `var(--fs-*)`), `tsc` web + host, `vitest run`.

**Вывод:** дедуп переиспользуется как есть — коннектору достаточно вернуть `TaskDraft`
с заполненным `externalId`. Основная работа — выбор коннектора (id + параметр repo)
и новый GitHub-коннектор.

## 4. Проектное решение

### 4.1. Реестр коннекторов — `src/core/connectors/registry.ts` (новый)

Единый источник истины о доступных коннекторах.

```ts
export interface ConnectorMeta {
  id: string;        // "beads" | "github"
  label: string;     // человекочитаемое имя для UI ("beads", "GitHub Issues")
  needsRepo: boolean; // github → true (нужно поле "owner/repo")
}

export const CONNECTORS: ConnectorMeta[] = [
  { id: "beads",  label: "beads",         needsRepo: false },
  { id: "github", label: "GitHub Issues", needsRepo: true  },
];

// Фабрика: вернуть коннектор по id с параметрами. Неизвестный id → undefined.
export function selectConnector(id: string, opts?: { repo?: string }): Connector | undefined;
```

`selectConnector`:
- `"beads"` → `beadsConnector()`.
- `"github"` → `githubConnector({ repo: opts?.repo ?? "" })`.
- иначе → `undefined`.

### 4.2. GitHub Issues коннектор — `src/core/connectors/github.ts` (новый)

Симметричен `beads.ts` (тот же стиль, инъекция `run` для тестов, защитный `try/catch`).

```ts
export type GhRunner = () => string;

export function githubConnector(opts: { repo: string; run?: GhRunner }): Connector;
```

- `id: "github"`.
- `run` по умолчанию (когда не подменён в тесте):
  `execFileSync("gh", ["issue", "list", "--repo", repo, "--state", "open",
  "--json", "number,title,body", "--limit", "1000"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })` — те же лимиты, что в beads.
- `import()`:
  - если `repo` пустой → `[]` (защитно, без вызова `gh`);
  - `JSON.parse(run())`; не массив / ошибка парсинга / ошибка процесса → `[]`;
  - для каждого элемента: `title` (строка, иначе пропуск),
    `description ← body` (если строка),
    `externalId = \`github:${repo}#${number}\`` (только если `number` — число).
- **Неймспейс `externalId`** (`github:owner/repo#123`) — обязателен, чтобы ref не
  пересекался с «голым» id из beads (`bd-7`) и не ломал дедуп.

### 4.3. Контракт рантайма — аддитивное расширение

`ConnectorsProvider.importDrafts` получает необязательный параметр выбора:

```ts
importDrafts(opts?: { connector?: string; repo?: string }): TaskDraft[];
```

Изменение **аддитивное и обратносовместимое**: существующие override-функции в тестах
(`() => [...]`) игнорируют аргумент и продолжают компилироваться/работать.

- `agent-runtime.ts` — обновить тип `ConnectorsProvider.importDrafts`.
- `claude-runtime.ts:37` — заменить хардкод на выбор через реестр:
  ```ts
  importDrafts: (opts) => {
    const c = selectConnector(opts?.connector ?? "beads", { repo: opts?.repo });
    return c ? c.import() : [];
  }
  ```
  По умолчанию (`connector` не задан) → beads, поведение сохранено.
- `api.ts:132` — тип `deps.importDrafts?: (opts?: { connector?: string; repo?: string }) => TaskDraft[]`.

### 4.4. HTTP API — `src/web/api.ts`

**Новый эндпоинт (список коннекторов для селектора):**

```
GET /api/connectors  →  { connectors: ConnectorMeta[] }
```
Отдаёт `CONNECTORS` из реестра (read-only).

**Изменённый эндпоинт импорта:**

```
POST /api/connectors/import
body: { connector?: string; repo?: string }   // оба необязательны
```
- читает тело защитно (`c.req.json().catch(() => ({}))`, как соседние эндпоинты);
- `connector` по умолчанию `"beads"`;
- **валидация:** если выбранный коннектор `needsRepo` (github), а `repo` пуст/не строка
  → `400 { error: "repo required" }`;
- вызывает `importDrafts({ connector, repo })` **как метод** (сохранить текущий паттерн
  вызова через `runtime.connectors.importDrafts(...)` при отсутствии `deps.importDrafts`);
- дедуп и подсчёт `{ created, skipped }` — без изменений.

### 4.5. Веб-клиент — `web/src/api.ts`

- Тип `ConnectorMeta` (зеркало серверного).
- `listConnectors(): Promise<ConnectorMeta[]>` → `GET /api/connectors`.
- `importTracker(opts?: { connector?: string; repo?: string }): Promise<{ created: number }>`
  → `POST /api/connectors/import` с телом `opts ?? {}`.

### 4.6. UI — `web/src/components/Connectors.tsx`

- При загрузке тянуть список коннекторов (`client.listConnectors()`), хранить выбранный
  `connector` (по умолчанию `"beads"`) в состоянии.
- Рядом с импортом — `<Select aria-label="Connector">` с опциями из реестра
  (`label`/`id`). Используем существующий компонент `Select` (как у Transport).
- Если у выбранного коннектора `needsRepo` — показать поле
  `<input placeholder="owner/repo">` для репозитория.
- Кнопку импорта переименовать в обобщённую **«Import»** (вместо «Import from beads»),
  `onClick` → `client.importTracker({ connector, repo })`.
- Чипы статуса (Importing… / Imported N / Nothing new to import / ошибка) — без изменений.
- **Дизайн-система:** только существующие классы (`inp`, `btn`, `chip`, `Select`),
  никаких новых `fontSize` (только `var(--fs-*)`); UI на английском. Пройти `check:ds`.

## 5. Затрагиваемые файлы

| Файл | Изменение |
|------|-----------|
| `src/core/connectors/registry.ts` | **новый** — `CONNECTORS`, `selectConnector` |
| `src/core/connectors/github.ts` | **новый** — `githubConnector` |
| `src/core/connectors/connector.ts` | без изменений (контракт достаточен) |
| `src/core/runtime/agent-runtime.ts` | тип `importDrafts(opts?)` |
| `src/core/runtime/claude-runtime.ts` | выбор коннектора через реестр |
| `src/web/api.ts` | `GET /api/connectors`; тело + валидация в `POST .../import`; тип `deps.importDrafts` |
| `web/src/api.ts` | `ConnectorMeta`, `listConnectors`, параметры `importTracker` |
| `web/src/components/Connectors.tsx` | селектор + поле repo + переименование кнопки |

## 6. Тесты

**Ядро — `test/core/connectors/github.test.ts` (новый):**
- маппинг `gh` JSON → drafts (инъекция `run`): title/description, пропуск без title;
- битый вывод / не-массив → `[]`;
- `externalId = github:owner/repo#<number>` (неймспейс), отсутствие `number` → без id;
- пустой `repo` → `[]` (без вызова `run`).

**Ядро — `test/core/connectors/registry.test.ts` (новый, лёгкий):**
- `selectConnector("beads")` / `("github",{repo})` возвращают коннектор с нужным `id`;
- неизвестный id → `undefined`;
- `CONNECTORS` содержит beads и github с корректным `needsRepo`.

**API — `test/web/api.test.ts` (добавить):**
- `GET /api/connectors` возвращает список из реестра;
- `POST /api/connectors/import` с `{ connector:"github", repo:"o/r" }` прокидывает
  параметры в `deps.importDrafts` (override проверяет полученные opts);
- `POST .../import` с `{ connector:"github" }` без repo → `400 { error:"repo required" }`;
- регрессия: существующие тесты импорта (без тела → beads, идемпотентность, пустой
  externalId) остаются зелёными.

**Веб — `web/src/components/Connectors.test.tsx` (обновить + добавить):**
- обновить существующие тесты на новую подпись кнопки **«Import»** (покрытие сохранено);
- выбор коннектора `GitHub Issues` показывает поле `owner/repo`;
- импорт шлёт `{ connector, repo }` в `importTracker` (через мок-клиент с захватом вызова).

**Команды проверки:** `npm run check:ds`, host `tsc`, web `tsc`, `vitest run` — все зелёные.

## 7. Acceptance criteria

1. В UI Connectors есть селектор источника со значениями из реестра (beads, GitHub Issues);
   для GitHub появляется поле `owner/repo`.
2. Импорт из **beads** работает как раньше (поведение по умолчанию не изменилось).
3. Импорт из **GitHub Issues** заводит открытые issues указанного репозитория задачами
   на борде; повторный импорт ничего не дублирует (дедуп по `external_ref`).
4. GitHub без указанного репозитория не выполняет импорт и даёт понятную ошибку.
5. Отсутствие/сбой `gh` не роняет хост — импорт возвращает пусто (как beads при сбое `bd`).
6. `check:ds`, web+host `tsc`, `vitest` — зелёные. UI на английском.

## 8. Риски и допущения

- **Смена подписи `importDrafts`** трогает интерфейс рантайма и несколько тестов, но
  изменение аддитивно (опциональный параметр) — существующие вызовы/override валидны.
- **Коллизия `external_ref`** между beads и github снимается неймспейсом
  `github:owner/repo#N`.
- **`gh` CLI** — внешний инструмент (по условию допустимо, self-contained); полагаемся
  на уже выполненную авторизацию пользователя. Отказоустойчивость — через `try/catch → []`.
- **Переименование кнопки** «Import from beads» → «Import» ломает один существующий
  веб-тест; он обновляется на новую подпись с сохранением проверяемого поведения.
