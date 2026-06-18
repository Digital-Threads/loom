# SDD — Connectors: MCP `args` + `env` + remote (SSE/HTTP) servers

- **Дата:** 2026‑06‑18
- **Область:** только loom‑host (модель `src/core/connectors/mcp.ts`, эндпоинт `src/web/api.ts`, веб `web/src/api.ts` + `web/src/components/Connectors.tsx`)
- **Принцип:** строго аддитивно — существующие stdio‑серверы, файл `~/.loom/mcp.json` и сцепка с агентом (`mcpRunConfig` → `writeMcpRunConfig` → `--mcp-config`) продолжают работать без изменений поведения.

---

## 1. Задача

Форма добавления MCP сейчас принимает только `id` + `command`. Нужно:

1. Дать в форме вводить **args** (массив) и **env** (переменные окружения) и сохранять их.
2. Поддержать второй тип сервера — **remote MCP**: SSE или HTTP по `url` (а не по команде).
3. Ничего не сломать: записи без новых полей остаются stdio‑серверами как раньше.

`args` уже частично поддержан в модели (`McpServer.args`, `addMcp`, `mcpRunConfig`) — не хватает ввода в форме и проброса. `env` и remote нужно добавить сквозняком.

---

## 2. Формат, который ждёт агент (проверено)

Claude CLI `--mcp-config <file>` читает JSON `{ "mcpServers": { <id>: <server> } }`, где сервер бывает двух видов (подтверждено докой Claude Code):

```jsonc
// stdio (локальный процесс)
{ "type": "stdio", "command": "npx", "args": ["-y", "pkg"], "env": { "API_KEY": "…" } }

// remote (удалённый)
{ "type": "http", "url": "https://example.com/mcp" }
{ "type": "sse",  "url": "https://example.com/sse" }
```

Для stdio поле `type` необязательно (текущий вывод его не пишет — оставляем как есть ради совместимости снапшотов/тестов). Для remote `type` обязателен. Заголовки (`headers`) для remote в этой версии **не вводим** — вне брифа.

---

## 3. Модель данных — `src/core/connectors/mcp.ts`

### 3.1 Тип `McpServer`

```ts
export type McpTransport = "stdio" | "sse" | "http";

export interface McpServer {
  id: string;
  command?: string;                 // было обязательным; теперь опционально (remote его не имеет)
  args?: string[];
  env?: Record<string, string>;     // НОВОЕ
  transport?: McpTransport;         // НОВОЕ; отсутствие == "stdio" (обратная совместимость)
  url?: string;                     // НОВОЕ; задаётся для sse/http
  enabled: boolean;
}
```

Хелпер: `function isRemote(s): boolean` → `s.transport === "sse" || s.transport === "http"`. Запись без `transport` трактуется как stdio.

### 3.2 `addMcp(input, file)`

Расширить вход: `{ id, command?, args?, env?, transport?, url? }`. Собрать `McpServer`, сохранив только осмысленные поля (не писать `env`, если пусто; не писать `command`/`args` для remote; не писать `url`/`transport` для stdio). Идемпотентность по `id` сохраняется (replace).

### 3.3 `mcpRunConfig(servers)` — ключевая логика

Тип результата расширяется до объединения:

```ts
type RunStdio  = { command: string; args?: string[]; env?: Record<string, string> };
type RunRemote = { type: "sse" | "http"; url: string };
function mcpRunConfig(servers): { mcpServers: Record<string, RunStdio | RunRemote> } | null
```

Для каждого `s` (как и сейчас — пропускаем `!s` и `!s.enabled`, и без валидного `id`):

- **remote** (`transport` ∈ {sse,http}): валиден при `typeof url === "string" && url` → `{ type: transport, url }`. Иначе запись отбрасывается (как сейчас отбрасывается битый stdio).
- **stdio** (иначе): валиден при `typeof command === "string" && command` (как сейчас). `args` — фильтр строк, добавляется только если непустой. `env` — добавляется только если это объект с ≥1 строковой парой (значения‑нестроки отбрасываются). Поведение для записей без `env` идентично текущему (zero behaviour change).

`testMcp` (probe `command --help`) применяется только к stdio. Для remote: либо вернуть `{ ok:false, error:"remote test not supported" }`, либо не показывать кнопку Test для remote (см. §5). Решение: оставить кнопку, для remote возвращать понятную ошибку «remote test not supported» — поведение для stdio не меняется.

`writeMcpRunConfig` — сигнатура и логика не меняются (просто пишет результат `mcpRunConfig`). Лаунчер `aimux-session-launcher.ts` **не трогаем**.

---

## 4. HTTP‑эндпоинт — `src/web/api.ts` (POST `/api/connectors/mcp`)

Сейчас парсит `id`/`command`/`args`. Дополнить:

- `env`: если это объект — оставить только пары `string→string`, иначе `undefined`.
- `transport`: принять только из {`"stdio"`,`"sse"`,`"http"`}, иначе `undefined`.
- `url`: строка или `undefined`.
- **Валидация:** `id` обязателен (string). Если remote (`transport` ∈ {sse,http}) — обязателен `url` (string), `command` не требуется. Если stdio (или transport не задан) — обязателен `command` (как сейчас). Иначе `400 { error: "id and command (stdio) or url (remote) required" }`.
- Передать всё в `addMcp(...)`.

GET/toggle/remove/test остаются без изменений.

---

## 5. Веб — `web/src/api.ts` и `Connectors.tsx`

### 5.1 `web/src/api.ts`

- Интерфейс `McpServer` синхронизировать с моделью: добавить `command?`, `env?`, `transport?`, `url?`.
- `mcpAdd` сигнатура: `(s: { id; command?; args?; env?; transport?; url? })`.

### 5.2 Форма `Connectors.tsx`

Добавить состояния: `transport` (default `"stdio"`), `args`, `env`, `url`. Поля (строго DS — классы `inp`/`btn`/`select`, без inline цветов/шрифтов; inline spacing‑числа допустимы):

- **select** типа: `stdio` / `sse` / `http` (английский UI).
- При `stdio`: поля `id`, `command`, `args`, `env` (как сейчас + два новых).
- При `sse`/`http`: поля `id`, `url` (command/args/env скрыты).
- `args` — один `inp`, парсинг: split по пробелам, выкинуть пустые → `string[]`. Placeholder `args (space-separated)`.
- `env` — один `inp`, парсинг: split по запятым, каждый элемент `KEY=VALUE` (split по первому `=`), trim, пустые/без `=` отбрасываются → `Record<string,string>`. Placeholder `env (KEY=VALUE, comma-separated)`.

`add()`:
- stdio: требуется `id` и `command`; шлёт `{ id, command, args?, env?, transport: "stdio" }` (или без transport для совместимости — отправлять `transport` явно).
- remote: требуется `id` и `url`; шлёт `{ id, url, transport }`.
- После успеха — очистить все поля, `refresh()`, toast как сейчас.

### 5.3 Таблица

Колонка «Command» показывает:
- stdio → `command` (+ кнопка Test как сейчас);
- remote → `url` с подписью транспорта (например chip `sse`/`http`).

Чип типа использует существующие классы `chip` (без своих цветов).

---

## 6. Что НЕ делаем (границы)

- Не вводим `headers` для remote, OAuth, авторизацию.
- Не меняем `writeMcpRunConfig`, лаунчер, формат имени файла run‑config.
- Не трогаем другие коннекторы (beads import) и другие разделы UI.

---

## 7. Риски / обратная совместимость

- **Старые записи** `mcp.json` без `transport`/`url`/`env`: читаются как раньше, `mcpRunConfig` для них выдаёт прежний `{command, args?}` (без `env`) → байт‑в‑байт прежний вывод, существующие тесты остаются зелёными.
- **`command` стал опциональным** в типе — проверить, что места использования (`testMcp`, лаунчер, агрегаторы в `aimux-session-launcher.ts`/`agent-runtime.ts`) не падают на `undefined`. `mcpRunConfig` уже фильтрует невалидный stdio.
- **Парсинг env с пробелами в значении**: значения с пробелами поддерживаются (split только по запятым на уровне пар и по первому `=` внутри пары). Запятая в значении — не поддерживается (документируем placeholder’ом, вне v1).

---

## 8. Тесты (TDD)

**`test/core/connectors/mcp.test.ts`** (host, vitest) — добавить:
- `mcpRunConfig` пробрасывает `env` для stdio (и не пишет `env`, когда пусто/нестроковые значения — старый вывод неизменен).
- remote‑сервер (`transport:"http"`, `url`) → `{ type:"http", url }`; `sse` аналогично.
- remote без `url` отбрасывается; stdio без `command` отбрасывается (как раньше).
- `addMcp` сохраняет `env`/`transport`/`url`; идемпотентность по `id` сохраняется.
- Обратная совместимость: запись `{command,args}` без новых полей → прежний `{command, args}`.

**`web/src/components/Connectors.test.tsx`** — добавить:
- При выборе `http`/`sse` поле `url` появляется, `command` скрывается; submit зовёт `mcpAdd` с `{ id, url, transport }`.
- При `stdio` ввод `args`/`env` парсится и уходит в `mcpAdd` как массив/объект.

## 9. Критерии приёмки

1. В форме можно добавить stdio‑сервер с `args` и `env`; они попадают в `mcp.run.json` в правильном формате.
2. В форме можно добавить remote (sse/http) сервер по `url`; в `mcp.run.json` он сериализуется как `{ type, url }`.
3. Старые stdio‑серверы и их run‑config не изменились.
4. `bun run check:ds` зелёный; UI на английском; `fontSize` только через `var(--fs-*)` (новых литералов не вводим).
5. `tsc` зелёный в host и web; новые тесты host+web проходят.
