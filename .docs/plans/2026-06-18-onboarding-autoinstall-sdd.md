# SDD — Онбординг: авто-доустановка зависимостей и плагинов

**Дата:** 2026-06-18
**Класс:** feature · **Scope:** только `loom-host` (self-contained)
**Журнал задачи:** tj-e1k9vnmvg7

---

## 1. Цель и контекст

После установки Loom пользователь не должен лезть в терминал. Экран первого
запуска (`web/src/components/Onboarding.tsx`, шаг «1 · Check your environment»)
уже показывает, какие инструменты есть/нет. Нужно довести его до конца:

- объяснить **зачем** каждый инструмент,
- дать **одну кнопку «Install missing»**, которая **реально** доустанавливает
  недостающее (системные инструменты + плагины),
- показывать **прогресс по шагам** с понятным текстом, быть **идемпотентной**
  (повторно не ставить) и при сбое давать **понятную ошибку**, не падая молча.

Bun не трогаем — он документированный пререквизит, Loom уже на нём работает.

### Что уже есть и переиспользуется (НЕ переписывать)

| Кусок | Где | Роль в фиче |
|---|---|---|
| `checkPrerequisites()` / `REQUIRED_TOOLS` | `src/core/doctor/prereqs.ts` | проверка node/npm/cargo/claude |
| `GET /api/doctor` | `src/web/api.ts:739` | уже отдаёт `PrereqReport` в Onboarding |
| `detect(spec, deps)` | `src/core/install/recipe.ts` | идемпотентная проба «уже стоит?» |
| `runRecipe(steps, ctx, deps)` | `src/core/install/recipe.ts` | выполняет шаги рецепта |
| Рецепты плагинов | `src/core/plugins/{token-pilot,task-journal}/plugin.json` → поле `install` | install/detect/remove готовы |
| `validateManifest(json).manifest.install` | `src/core/plugins/manifest.ts` | достать рецепт из plugin.json (паттерн из `test/core/install/recipes-3plugins.test.ts`) |
| `InstallDeps { dataDir, run }`, `CmdRunner`, `CmdResult` | `src/core/install/types.ts` | контракт запускалки |
| `streamSSE` (hono) | `src/web/api.ts:1745` | образец SSE-стрима в проект |

> Уточнение к брифу: рецепты лежат в `src/core/plugins/*/plugin.json`, а не в
> `src/core/install/*/plugin.json`. Сам движок install — в `src/core/install/`.

---

## 2. Ключевое ограничение (определяет дизайн)

`runner.defaultRun` (`src/core/install/runner.ts`) — это `execFileSync` **без
shell** и с **таймаутом 5000 мс**. Годится для быстрых проб (`detect`), но **не
годится для реальной установки**:

1. `curl https://sh.rustup.rs -sSf | sh` — это shell-пайп, его нельзя выразить
   как `cmd + args` без оболочки.
2. `cargo install …` и `npm install -g …` идут **минутами** → 5-секундный
   таймаут их убьёт.
3. Нет покомандного колбэка прогресса.

**Вывод:** для установки нужен отдельный **долгоживущий runner с shell и большим
таймаутом**, инжектируемый аддитивно. `defaultRun` и контракт CLI не трогаем.

---

## 3. Архитектура решения

Три слоя, все изменения аддитивные.

### 3.1. Core — план установки (`src/core/install/bootstrap.ts`, новый файл)

Описывает **упорядоченный список «install units»** — что и в каком порядке
доустанавливать. Порядок важен: `cargo`/`claude` — пререквизиты плагинов.

```
InstallUnit = {
  id: string;            // "cargo" | "claude" | "token-pilot" | "task-journal"
  title: string;         // англ., для UI
  why: string;           // англ., зачем этот инструмент (показываем в прогрессе)
  detect: DetectSpec;    // проба «уже стоит?» — идемпотентность
  steps: RecipeStep[];   // шаги установки
  requires?: string[];   // id юнитов-пререквизитов (gating)
}
```

Единицы:

1. **cargo** — `why`: «builds the task-journal binary».
   `detect`: `which cargo`.
   `steps` (shell, optional-fallback не нужен): один шаг
   `{ cmd: "sh", args: ["-c", "curl https://sh.rustup.rs -sSf | sh -s -- -y"] }`.
   После rustup `cargo` появляется в `~/.cargo/bin` — для текущего процесса
   PATH дополняем (см. 3.2), чтобы последующий detect его увидел.
2. **claude** — `why`: «runs the AI agent that powers every task».
   `detect`: `which claude`.
   `steps`: предпочтительно npm (node уже есть как пререквизит Loom):
   `{ cmd: "npm", args: ["install","-g","@anthropic-ai/claude-code"] }`;
   запасной официальный установщик через shell, если npm недоступен —
   решается на этапе RnD/impl, в SDD фиксируем точку выбора.
3. **token-pilot** — `why`: «token-efficient code reading for agents».
   `detect`/`steps` = из `token-pilot/plugin.json` (`validateManifest().install`).
4. **task-journal** — `why`: «persistent task memory across sessions».
   `detect`/`steps` = из `task-journal/plugin.json`. Требует `cargo` и `claude`.

Чистая функция-планировщик:

```
planMissing(units, deps): { id, status: "present"|"missing"|"blocked", reason? }[]
```

— для каждого юнита `detect()`; если уже стоит → `present` (пропустить);
если пререквизит `missing`/`blocked` → `blocked` (с причиной). Без побочных
эффектов — легко тестируется фейковым runner.

### 3.2. Long-running runner (`src/core/install/shell-runner.ts`, новый файл)

`makeShellRunner(opts)` → `CmdRunner`, который:

- запускает через оболочку, когда `cmd === "sh"` (или универсально
  `execFileSync(cmd, args, { shell: false })` для обычных команд и
  `{ shell: true }`/`spawn` для shell-шагов — детали в impl),
- таймаут большой (напр. 10 мин, конфигурируемо),
- возвращает тот же `CmdResult { ok, stdout, stderr }` (контракт неизменен),
- после успешной установки rustup дополняет `process.env.PATH` на
  `~/.cargo/bin`, чтобы detect видел свежий `cargo` без перезапуска.

`defaultRun` остаётся как есть — это runner для проб и CLI.

### 3.3. Web — эндпоинт установки (SSE)

Добавить в `createApi` (`src/web/api.ts`):

- **`ApiDeps.installRunner?: CmdRunner`** — инъекция (по образцу `prereqs?`);
  прод-дефолт = `makeShellRunner()`. В тестах подменяется фейком.
- **`GET /api/onboarding/install/stream`** (или `POST` + SSE) — стримит прогресс:
  - `planMissing(units, { dataDir, run: defaultRun })` — что ставить (быстрые пробы);
  - по порядку для каждого юнита со статусом `missing`:
    - `event: step` `{ id, title, why, state: "installing" }`,
    - запуск: для плагинов — `runRecipe(unit.steps, { scope:"user" }, { dataDir, run: installRunner })`;
      для системных — те же `steps` через `installRunner`,
    - `event: step` `{ id, state: "done" | "skipped" | "failed", message }`,
    - юниты со статусом `present` → `state: "skipped"` (already installed),
    - `blocked` (упал пререквизит) → `state: "skipped", message: "needs <X>"`;
  - финал: `event: done` `{ installed: string[], failed: string[], skipped: string[] }`.
  - Любой сбой → событие `failed` со стенографией `stderr` (обрезанной), **поток
    не рвём** и не роняем процесс.

> Альтернатива без SSE (пошаговый polling) рассмотрена и отклонена: проект уже
> использует `streamSSE`, единый стрим даёт честный live-прогресс одним запросом.

### 3.4. Web-клиент (`web/src/api.ts`)

Добавить (аддитивно к фабрике клиента):

- `installMissingStreamUrl(): string` → URL SSE-эндпоинта (по образцу
  `runStreamUrl`), либо метод, открывающий `EventSource` и пробрасывающий
  события наверх. Конкретная форма — как у существующих стримов в клиенте.

### 3.5. UI (`web/src/components/Onboarding.tsx`)

Шаг «1 · Check your environment», аддитивно:

- рядом с каждым инструментом — короткий **why** (берём из `unit.why`/`hint`);
- кнопка **«Install missing»** показывается, когда есть недостающее;
- по клику — подписка на SSE, для каждого юнита строка прогресса:
  `installing… → done / skipped (already installed) / failed: <reason>`;
- по завершении — авто-`load()` (повторный `doctor()`), чтобы чипы статусов
  обновились; если всё ок — пользователь идёт к шагам 2–3;
- ошибки (нет интернета/прав) видны строкой у конкретного юнита, экран не падает.
- **DS:** любой `fontSize` — только `var(--fs-*)`; цвета/шрифты — токены
  (`check:ds`). Текст UI — английский.

---

## 4. Затрагиваемые файлы

**Новые:**
- `src/core/install/bootstrap.ts` — `InstallUnit`, список юнитов, `planMissing`.
- `src/core/install/shell-runner.ts` — `makeShellRunner`.
- `test/core/install/bootstrap.test.ts`, `test/core/install/shell-runner.test.ts`.

**Изменяемые (аддитивно):**
- `src/web/api.ts` — `ApiDeps.installRunner?`, SSE-роут установки.
- `web/src/api.ts` — метод/URL стрима установки + типы событий.
- `web/src/components/Onboarding.tsx` — кнопка, прогресс, why-тексты.
- `test/web/api.test.ts` (или новый) — SSE-последовательность с фейк-runner.

**НЕ трогаем:** `runner.defaultRun`, `recipe.ts`, `preflight.ts`, `detect`,
`plugin.json` рецепты, `src/cli/plugin-cli.ts`, `prereqs.ts` логику.

---

## 5. Поведение по шагам (happy path)

1. Свежая машина: есть `node`/`npm`/`bun`, нет `cargo`, `claude`, плагинов.
2. Onboarding показывает: claude — missing, cargo — missing (+ why у каждого).
3. Клик «Install missing» → SSE:
   - `claude`: installing → done;
   - `cargo`: installing (rustup) → done, PATH дополнен;
   - `token-pilot`: installing → done;
   - `task-journal`: installing (cargo bins + claude plugin) → done.
4. `done { installed: [4], failed: [], skipped: [] }` → авто-refresh статусов →
   всё зелёное, пользователь продолжает онбординг.

**Идемпотентность:** повторный клик → все юниты `skipped (already installed)`,
ничего не ставится (детект перед каждым).

**Сбой (нет интернета):** напр. `cargo` → `failed: <stderr>`; зависимый
`task-journal` → `skipped: needs cargo`; поток доходит до `done`, экран жив,
пользователь видит, что чинить.

---

## 6. Критерии приёмки

- [ ] На машине без `cargo`/`claude`/плагинов одна кнопка доустанавливает всё;
      после — `GET /api/doctor` показывает их `found`, плагины в claude-реестре.
- [ ] Повторный запуск ничего не ставит повторно (все `skipped`).
- [ ] Сбой одного юнита не роняет поток и процесс; зависимые помечены `needs <X>`;
      пользователь видит понятную причину.
- [ ] Каждый шаг в UI сопровождается понятным «что ставится и зачем».
- [ ] rustup идёт официальным `curl https://sh.rustup.rs -sSf | sh -s -- -y`;
      плагины — существующими рецептами из их `plugin.json` (не дублируем).
- [ ] `defaultRun`, рецепты, CLI не изменены (только аддитивные правки).
- [ ] Тесты: `planMissing` (идемпотентность, gating пререквизитов, shell-форма
      rustup-шага), SSE-последовательность (done/skipped/failed) на фейк-runner.
- [ ] `bun run check:ds` зелёный; `tsc` для web и host зелёный; все тесты зелёные.

---

## 7. Риски и открытые вопросы (на RnD)

- **Установщик `claude`:** npm-пакет (`@anthropic-ai/claude-code`) vs официальный
  `curl … | sh`. Решить на RnD — выбрать основной путь и запасной.
- **PATH после rustup:** `cargo` появляется в `~/.cargo/bin`; нужно дополнить
  `process.env.PATH` в текущем процессе, иначе последующий detect его не найдёт.
- **Права/окружение:** npm `-g` может требовать прав; учесть в тексте ошибки
  (понятное сообщение, не стек-трейс).
- **Таймаут/зависание сети:** разумный потолок таймаута у shell-runner, чтобы
  поток не висел вечно.
- **Согласие пользователя:** установка по кнопке (явное действие), не авто —
  меняем систему/сеть только с явного согласия.
