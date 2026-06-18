# SDD — Runtime-adapter seam: интерфейс `AgentRuntime` + `ClaudeRuntime`

Дата: 2026-06-18 · Класс: chore (рефактор-развязка) · UI: English

## 1. Постановка

Сейчас движок жёстко зашит как Claude: конвейер и веб-API напрямую тянут
Claude-специфичные вещи — спавн `claude` через aimux, чтение `~/.claude/skills`,
список MCP-коннекторов, recall через task-journal. Эти знания разбросаны по
`src/web/api.ts` и `src/core/*`.

Цель — **ввести один интерфейс `AgentRuntime` и спрятать за ним всё
Claude-специфичное**, чтобы конвейер/API зависели от интерфейса, а не от слова
«claude». Движок остаётся один — Claude (`ClaudeRuntime` — единственная
реализация). Это **чистый рефактор**: поведение не меняется, новых фич и новых
движков (Codex/DeepSeek) не добавляем.

### Не-цели

- Не добавлять второй движок и не писать заготовки под него сверх самого
  интерфейса.
- Не менять бизнес-логику ручек API, формат ответов, UI.
- Не трогать host-конфиг `~/.claude` иначе как read-only внутри `ClaudeRuntime`.

## 2. Текущее состояние (факты из кода)

Заземление из брифа местами неточно — фактическая карта:

- **Сессия агента (спавн `claude`)**: `src/core/automation/aimux-session-launcher.ts`
  — `createAimuxLiveLauncher()` → `spawnSession` собирает aimux-параметры и
  `spawn`-ит CLI, оборачивается в `createLiveSessionLauncher` из
  `live-session.ts`. Интерфейс `SessionLauncher` (`task-session.ts:14`) **уже
  движок-нейтральный** — переиспользуем как есть.
- **Скилы**: `src/core/skills/skills.ts` — `listSkills/readSkill/writeSkill/generateSkill`.
  Жёстко зашит путь `~/.claude/skills` (`skillsRoot()`), промпт генерации говорит
  «скилл для Claude Code». Это Claude-специфика.
- **Коннекторы**: `src/core/connectors/` — `connector.ts` (`Connector { id; import(): TaskDraft[] }`),
  `beads.ts` (`beadsConnector`), `mcp.ts` (`listMcp/addMcp/...`). ⚠ Файла
  `connectors/claude.ts` **нет**; `mcp.ts` читает **не** `~/.claude.json`, а
  собственный Loom-файл `loomDataDir()/mcp.json`. Парсинга
  `~/.claude.json`/`installed_plugins.json` в `src/` нет (поиск `installed_plugins`
  — ноль). То есть «коннекторы» сегодня = `listMcp()` + `beadsConnector()`, и они
  уже не привязаны к host-конфигу Claude.
- **Recall**: `src/web/api.ts` `recallRunner` (~L147) → CLI `task-journal recall --json`;
  плюс `search` через `askSearch`. Опциональная часть рантайма.
- **StageAgent**: `src/core/pipeline/stage-agent.ts` `createAimuxStageAgent()` —
  one-shot aimux headless; используется как `skillAgent` по умолчанию
  (`api.ts:1238`) и для диалоговых стадий.
- **Точка сборки (DI)**: `src/web/api.ts`, `createApi(db, deps)` / `ApiDeps`.
  Claude-дефолты раскиданы по отдельности:
  - `sessionLauncher ?? createAimuxLiveLauncher({ sandbox })` — L256
  - `skillAgent ?? createAimuxStageAgent({ profile })` — L1238
  - `listSkills()` — L1223; `readSkill/writeSkill/generateSkill` — рядом
  - `listMcp()` — L1154
  - `importDrafts ?? (() => beadsConnector().import())` — L1170
  - `recall ?? recallPrior(..., { run: recallRunner })` — L155
- **Дак-тайпинг launcher’а** — самое грязное место. К `sessionLauncher` много раз
  кастуют `as { costOf?/denialsOf?/interject?/stop? }` (L271, 287, 525, 572, 741,
  755, 774, 853, 1030). Эти методы возвращает `createLiveSessionLauncher`, но в
  типе `SessionLauncher` их нет.

## 3. Дизайн

### 3.1 Интерфейс `AgentRuntime`

Новый файл `src/core/runtime/agent-runtime.ts`. Интерфейс собирает ровно те
четыре способности, что нужны конвейеру/API (скоуп брифа):

```ts
export interface AgentRuntime {
  /** Идентификатор движка (для логов/диагностики). */
  readonly id: string;            // "claude"

  /** (a) Запуск/ведение сессии агента — уже существующий контракт. */
  readonly launcher: SessionLauncher & SessionControl;

  /** (b) Библиотека скилов движка. */
  readonly skills: SkillsProvider;

  /** (c) Коннекторы (MCP-серверы + трекеры). */
  readonly connectors: ConnectorsProvider;

  /** (d) Опц. recall прошлых рассуждений. */
  readonly recall?: (query: string) => RecallHit[];
}
```

Вспомогательные контракты (минимальные, отражают то, что уже вызывается):

```ts
/** Жизненный цикл живой сессии — то, что сейчас добывается дак-тайпингом. */
export interface SessionControl {
  costOf(sessionId: string): number;
  denialsOf(sessionId: string): string[];
  interject(sessionId: string, text: string): boolean;
  stop(sessionId: string): void;
}

export interface SkillsProvider {
  list(): SkillMeta[];
  read(name: string): string | null;
  write(name: string, content: string): boolean;
  generate(description: string, agent: (p: string) => Promise<string>):
    Promise<{ name: string; content: string } | null>;
}

export interface ConnectorsProvider {
  /** MCP-серверы движка. */
  listMcp(): McpServer[];
  /** Импорт черновиков задач из трекеров (beads и т.п.). */
  importDrafts(): TaskDraft[];
}
```

`SessionLauncher`, `SkillMeta`, `McpServer`, `TaskDraft`, `RecallHit` —
переиспользуем существующие типы (импорт), новых сущностей не плодим.

**Решение:** `SessionControl` делаем частью контракта launcher’а, а не оставляем
дак-тайпинг. Это убирает девять `as {...}` из `api.ts` и формализует течь
абстракции. `createLiveSessionLauncher` уже возвращает эти методы — меняется
только тип возврата (структурно совместим), не реализация.

### 3.2 `ClaudeRuntime` — единственная реализация

Новый файл `src/core/runtime/claude-runtime.ts`:

```ts
export function createClaudeRuntime(deps: ClaudeRuntimeDeps = {}): AgentRuntime {
  return {
    id: "claude",
    launcher: deps.launcher ?? createAimuxLiveLauncher({ sandbox: deps.sandbox }),
    skills: {
      list: listSkills, read: readSkill, write: writeSkill, generate: generateSkill,
    },
    connectors: {
      listMcp,
      importDrafts: () => beadsConnector().import(),
    },
    recall: deps.recall,   // прокинут из api (нужен projectRoot) — см. 3.3
  };
}
```

Вся Claude-специфика (aimux-launcher, `~/.claude/skills`, `mcp.json`,
beads-импорт) живёт здесь. `src/web/api.ts` больше не импортирует
`createAimuxLiveLauncher`/`listSkills`/`listMcp`/`beadsConnector` напрямую —
только `createClaudeRuntime` и тип `AgentRuntime`.

### 3.3 Внедрение в `createApi`

`ApiDeps` получает один новый необязательный вход `runtime?: AgentRuntime`.
В начале `createApi`:

```ts
const runtime = deps.runtime ?? createClaudeRuntime({
  sandbox: () => getSetting<boolean>(db, "sandbox.enabled", false),
});
```

Дальше точечно переключаем точки сборки на `runtime`:

- `sessionLauncher` → `runtime.launcher` (убираем касты `as {...}` — методы
  теперь в типе).
- ручки `/api/skills*` → `runtime.skills.*`.
- `/api/connectors/mcp` → `runtime.connectors.listMcp()`.
- `importDrafts` → `runtime.connectors.importDrafts()`.
- recall → `runtime.recall` (если задан).

**Совместимость по тестам:** существующие точечные `deps.sessionLauncher`,
`deps.skillAgent`, `deps.recall`, `deps.importDrafts` **сохраняем** как
переопределения с приоритетом над `runtime` (чтобы не переписывать
`test/web/api.test.ts`). Порядок: `deps.<x>` → `runtime.<x>` → дефолт внутри
ClaudeRuntime. Это минимизирует blast-radius.

`skillAgent` (one-shot агент генерации) и `stageAgent` (диалоговые стадии)
остаются отдельными deps — они уже движок-нейтральны (`StageAgent = (p) =>
Promise<string>`) и в скоуп интерфейса не входят (бриф перечисляет launcher /
skills / connectors / recall). Фиксируем это как осознанную границу.

## 4. План тестирования (TDD)

1. **Новый тест** `test/core/runtime/agent-runtime.test.ts` — мок-`AgentRuntime`
   (фейковый launcher + статичные skills/connectors) прокидывается в `createApi`,
   и проверяется, что конвейер ходит через интерфейс: запуск стадии вызывает
   `runtime.launcher.run`, `/api/skills` отдаёт `runtime.skills.list()`,
   `/api/connectors/mcp` — `runtime.connectors.listMcp()`. Это доказывает
   развязку (требование брифа п.4).
2. **Существующие тесты зелёные** — `test/web/api.test.ts`,
   `test/core/automation/live-session.test.ts` и пр. без изменений (благодаря
   сохранению точечных deps-переопределений).
3. `npm run check:ds` (в `web/`) — зелёный (UI не трогаем, но проверяем).
4. Полный прогон тестов — без регрессий.

## 5. Файлы

**Создаём:**
- `src/core/runtime/agent-runtime.ts` — интерфейс + вспомогательные контракты.
- `src/core/runtime/claude-runtime.ts` — `createClaudeRuntime`.
- `test/core/runtime/agent-runtime.test.ts` — тест на мок-рантайме.

**Меняем:**
- `src/web/api.ts` — `ApiDeps.runtime`, сборка `runtime`, переключение точек
  (launcher/skills/connectors/recall), удаление девяти кастов `as {...}`.
- `src/core/automation/live-session.ts` — экспортировать тип контрол-методов
  (`SessionControl`) или сделать возврат `createLiveSessionLauncher`
  именованным типом, чтобы `AgentRuntime` на него ссылался.

## 6. Критерии приёмки

- [ ] Введён `AgentRuntime`; `ClaudeRuntime` — единственная реализация.
- [ ] `src/web/api.ts` не импортирует `createAimuxLiveLauncher`, `listSkills`,
      `listMcp`, `beadsConnector` напрямую — только через рантайм.
- [ ] Девять кастов `sessionLauncher as {...}` удалены (методы в типе).
- [ ] Новый тест с мок-рантаймом зелёный; все прежние тесты зелёные.
- [ ] `npm run check:ds` зелёный. Поведение и формат ответов не изменились.
- [ ] Host `~/.claude` читается только внутри `ClaudeRuntime` (read-only).

## 7. Риски и открытые вопросы

- **Граница «коннекторов».** Сегодня = `listMcp` (Loom `mcp.json`) + beads, **не**
  host `~/.claude.json`. Принимаем это как факт; если заказчик ждал парсинг
  `installed_plugins.json` — этого кода нет, фиксируем как вне скоупа.
- **`stageAgent`/`skillAgent` вне интерфейса.** Осознанное решение: они
  движок-нейтральны и не входят в перечень брифа. Если потребуется — добавим
  позже без слома `AgentRuntime`.
- **`api.ts` большой (1494 строки).** Меняем только сборку и касты, бизнес-логику
  ручек не трогаем — изменения хирургические.
- **Совместимость тестов** держится на сохранении точечных deps-переопределений
  поверх `runtime`. Если их убрать — придётся переписывать `api.test.ts`; в
  скоуп это не входит.
