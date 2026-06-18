# SDD — C2: Гарантированный журнал задачи (auto-openTask + snapshot на парковках)

- **Дата:** 2026-06-18
- **Класс:** feature
- **Скоуп:** только loom-host (`src/web/api.ts`, при необходимости тонко — `adapter.ts`)
- **Journal task:** tj-p3anpgx5zf

---

## 1. Проблема

Журнал рассуждений (task-journal) у loom-задачи сейчас зависит от того, вызвал ли
сам агент `task_create`. Если забыл — задача остаётся **без журнала** и **без
привязки** `loom:<id>`. Дополнительно:

- `snapshotJournal(id)` (`api.ts:648`) делает ранний `return` при `events.length === 0`
  (`api.ts:653`) — пустой журнал нигде не виден.
- Снимок журнала снимается **только на Done** (`api.ts:1483`, `api.ts:826`). Любая
  **парковка** (rate-limit / cost-cap / needs-attention / stop / crash) журнал не
  фиксирует → после удаления worktree журнал теряется.
- `journalProjectRoot(id)` (`api.ts:396`) возвращает `null` для non-git задач — они
  никак не помечены («нет своего журнального проекта»).

## 2. Цель

Сделать журнал гарантированным и не зависящим от агента:

1. **На старте задачи** (в момент создания worktree) автоматически заводить
   журнальную задачу: `openTask(projectRoot, title, goal)` + сразу
   `bindExternal(loom:<id>)`, независимо от агента.
2. **Снимок журнала на КАЖДОМ терминальном / парк-переходе**
   (rate-limit, cost-cap, needs-attention, stop/crash), не только на Done.
3. Задачу с **0 журнальных событий** — явно пометить.
4. **non-git** задачи (`journalProjectRoot=null`) — явно пометить `no journal`.

Не ломать существующую логику `boardJournalPack`/`snapshotJournal`
(live → snapshot → raw-fallback).

## 3. Не-цели (scope-lock)

- Не трогать сам CLI `task-journal` и формат его событий.
- Не менять UI-вёрстку History/панелей сверх минимума, нужного для пометок.
- Не рефакторить соседний несвязанный код, не «улучшать» worktree-lifecycle.
- Не удалять и не ослаблять существующие тесты.

---

## 4. Текущее устройство (факты из кода)

| Что | Где | Поведение |
|---|---|---|
| `journalProjectRoot(id)` | `api.ts:396` | git+repo → корень worktree; иначе `null` |
| `taskCwd(id)` → `ensureWorktree` | `api.ts:384`, `:386` | ленивое создание worktree (дёргается каждой стадией) |
| `snapshotJournal(id)` | `api.ts:648` | ранний `return` при пустом; пишет artifact `journal-snapshot` (stage `memory`); `bindExternal(loom:<id>)` |
| `boardJournalPack(id)` | `api.ts:631` | live story → snapshot story → live journal → snapshot events |
| Done | `api.ts:1483`, `:826` | `snapshotJournal` + `snapshotDiff` + cleanup |
| Park → `updateTaskStatus("waiting")` | `api.ts:1107`, `:1153`, `:1425`, `:1439`, `:2054` | переход в «waiting», снимок журнала НЕ снимается |
| `openTask` | `adapter.ts:294` | CLI `task-journal create`; **не импортирован** в `api.ts:14` |
| `bindExternal` | `adapter.ts:226` | CLI `task-journal external --add` |
| `exportEventsSafe` | `adapter.ts:135` | события проекта или `[]` |
| `tasksFromEvents` | `adapter.ts:25` | группировка событий по journal task id |

Парк-сайты повторяют один паттерн:
`if (res.stoppedAt && getTask(db, id)?.status !== "done") updateTaskStatus(db, id, "waiting")`
(плюс `api.ts:1107` — stop по кнопке, без `stoppedAt`).

---

## 5. Решение

Три аддитивных помощника в `api.ts` (внутри `serveApi`, рядом с журнальным блоком
`api.ts:620–659`), плюс точечные вызовы.

### 5.1. Авто-журнал на старте — `ensureJournalTask(id)`

Идемпотентный помощник, гарантирующий журнальную задачу для git-задачи:

```
ensureJournalTask(id):
  root = journalProjectRoot(id)        // null для non-git → no-op (см. 5.4)
  if !root: return
  events = exportEventsSafe(root)
  // уже есть привязка loom:<id> → ничего не делаем (идемпотентность)
  if tasksFromEvents(events).some(t => journal task привязан к loom:<id>): return
  // нет журнальной задачи → завести и привязать
  jid = openTask(root, t.title, goal)  // goal = t.description || t.title
  if jid: bindExternal(root, jid, `loom:${id}`)
```

- **Точка вызова:** в `taskCwd(id)` (`api.ts:384`) сразу после получения пути
  worktree (`ensureWorktree(...)`), т.е. в момент, когда worktree реально создан.
  Это единственное место создания worktree; вызывается на каждой стадии — поэтому
  помощник **обязан быть идемпотентным**.
- **Идемпотентность:** проверяем наличие journal-задачи с внешней привязкой
  `loom:<id>`. Если `exportEventsSafe` уже содержит open-событие journal-задачи,
  привязанной к `loom:<id>` — не создаём вторую. (Привязка проверяется через
  события/`external`; точная проверка уточняется в RD — допустимо «есть хотя бы одна
  journal-задача в проекте» как достаточное условие, т.к. worktree 1:1 с loom-задачей.)
- **Best-effort:** весь помощник в `try/catch`, любая ошибка CLI не должна ломать
  старт/стадию задачи.

### 5.2. Snapshot на парковках — `parkIfNotDone(id)`

Единый chokepoint вместо размазанного паттерна по 5 местам:

```
parkIfNotDone(id):
  if getTask(db, id)?.status === "done": return false
  updateTaskStatus(db, id, "waiting")
  snapshotJournal(id)        // фиксируем журнал в момент парковки
  return true
```

Заменяет паттерн в:
- `api.ts:1425` (advance),
- `api.ts:1439` (run-stage),
- `api.ts:1153` (account-switch advance),
- `api.ts:2054` (auto-fallback),
- `api.ts:1107` (stop по кнопке — здесь нет `stoppedAt`, вызываем безусловно).

Семантика «не трогаем done» сохраняется (как было). Снимок best-effort → не влияет
на ответ эндпоинта.

### 5.3. Пустой журнал — помечать, а не молчать

`snapshotJournal(id)` (`api.ts:648`) перестаёт молча выходить при пустом журнале:

```
snapshotJournal(id):
  root = journalProjectRoot(id)
  if !root: markNoJournal(id, "non-git"); return     // см. 5.4
  events = exportEventsSafe(root)
  if !events.length:
    markNoJournal(id, "empty")                        // пометка вместо return
    return
  saveResult(id, "memory", JOURNAL_SNAPSHOT_KIND, {events, story: boardTaskStory(root)})
  for t in tasksFromEvents(events): bindExternal(root, t.id, `loom:${id}`)
```

- Существующий happy-path (есть события) — **без изменений** по сути и по форме
  artifact'а `journal-snapshot`, чтобы `boardJournalPack` и History читались как
  раньше.

### 5.4. Пометка «нет журнала» — `markNoJournal(id, reason)`

```
markNoJournal(id, reason):  // reason: "empty" | "non-git"
  saveResult(id, "memory", JOURNAL_STATUS_KIND, { state: "none", reason })
```

- Новый artifact-kind `JOURNAL_STATUS_KIND = "journal-status"` (stage `memory`).
- `boardJournalPack(id)` (`api.ts:631`) при пустом результате может вернуть короткую
  пометку для History (англ. текст), читая `journal-status`. Минимально: если
  pack пуст и есть `journal-status.state==="none"` → вернуть строку-маркер
  (`No reasoning journal recorded (<reason>).`). DS-нейтрально (markdown-строка, без
  новой вёрстки) — если потребуется UI-бейдж, fontSize только `var(--fs-*)`.

### 5.5. Импорт

В `api.ts:14` добавить `openTask` в импорт из `../core/plugins/task-journal/adapter.js`.

---

## 6. Изменяемые файлы

| Файл | Изменение |
|---|---|
| `src/web/api.ts` | +`openTask` в импорт; +`ensureJournalTask`, `parkIfNotDone`, `markNoJournal`, `JOURNAL_STATUS_KIND`; правка `taskCwd`, `snapshotJournal`, `boardJournalPack`; замена 5 парк-сайтов на `parkIfNotDone` |
| `src/core/plugins/task-journal/adapter.ts` | по возможности без изменений (используем существующие экспорты) |
| `test/...` | новые тесты (раздел 8) |

---

## 7. Критерии приёмки

1. Создание git-задачи и запуск любой стадии → в журнальном проекте появляется
   journal-задача, привязанная к `loom:<id>`, **без** вызова `task_create` агентом.
2. Повторный запуск стадий **не плодит** дубликаты journal-задач (идемпотентность).
3. Парковка по rate-limit / cost-cap / stop / auto-fallback → создаётся artifact
   `journal-snapshot` (если есть события) **до** удаления worktree.
4. git-задача с 0 журнальных событий → artifact `journal-status` `{state:"none",reason:"empty"}`.
5. non-git задача → artifact `journal-status` `{state:"none",reason:"non-git"}`,
   journal-задача не создаётся.
6. `boardJournalPack` для задачи с событиями работает как раньше (регрессия не сломана).
7. UI-тексты пометок — английские; DS-проверка `check:ds` зелёная; никаких
   raw `font-size` (только `var(--fs-*)`).
8. `tsc --noEmit` для web и host зелёные (через `-b --force`, не инкрементальный кэш);
   тесты зелёные.

## 8. План тестов

- **ensureJournalTask:** мок CLI/адаптера → на старте git-задачи зовётся `openTask`+`bindExternal`; повторный вызов не создаёт второй журнал (идемпотентность); non-git → не зовётся.
- **parkIfNotDone:** при `stoppedAt` и статусе ≠ done → статус `waiting` + `snapshotJournal` вызван; при статусе done → no-op.
- **snapshotJournal empty:** пустые события → пишется `journal-status {reason:"empty"}`, не пишется `journal-snapshot`.
- **markNoJournal non-git:** `journalProjectRoot=null` → `journal-status {reason:"non-git"}`.
- **регрессия:** задача с событиями → `journal-snapshot` пишется, `boardJournalPack` отдаёт story как раньше.

Стиль тестов — по образцу `test/core/plugins/task-journal/actions.test.ts` и
`journal-render.test.ts`.

## 9. Риски и открытые вопросы (→ RD)

- **R1.** Точная проверка идемпотентности привязки `loom:<id>` в `ensureJournalTask`
  (через `external` list vs «есть хотя бы одна journal-задача»). Уточнить в RD.
- **R2.** `taskCwd` дёргается часто; `ensureJournalTask` обращается к CLI —
  убедиться, что повторные вызовы дёшевы (после первого создания — ранний выход по
  наличию журнала). При необходимости — in-memory guard `Set<id>` на сессию сервера.
- **R3.** Формат пометки в `boardJournalPack`/History — минимальный markdown-маркер
  vs UI-бейдж. Базово берём markdown; UI-бейдж только если History реально показывает
  пустоту неинформативно.
- **R4.** Все CLI-вызовы best-effort: ни старт, ни парковка, ни Done не должны падать
  из-за отсутствия/ошибки `task-journal`.
