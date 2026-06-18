# R&D-план (DAG) — Связка task-journal ↔ борд-задача ↔ Memory

- Дата: 2026-06-18 · Задача журнала: tj-8b7w3ckhkw
- Базируется на SDD `2026-06-18-task-journal-board-linkage-sdd.md`
- Ограничение: только loom-host. task-journal не меняем.

## Проверенные на этом шаге факты (входят в план)

- `ensureWorktree(repo,id).path === worktreePath(id)` = `securityDataDir()/worktrees/<id>`
  (`loom-security/sandbox.js:30,49`) → cwd агента точно равен `worktreePath(id)`.
- `~/.loom` — реальный каталог (не симлинк); worktree — реальный каталог.
- Без симлинков `export --project <path>` возвращает события и после удаления каталога.
  При симлинке в пути хэши create-cwd и export расходятся → пусто. Поэтому read-through
  страхуем снапшотом.
- Точки жизненного цикла: каждая стадия идёт в worktree через `sessionSend` (api.ts:336,
  рядом `saveResult`/`recordSessionCost`); финал — `runDone` (pr-done.ts:130) c
  `closeTask`. Снапшот делаем на Done (worktree ещё существует).
- Хранилище результатов: `saveResult(id,stage,kind,data)` (api.ts:421) пишет в
  attachment-store, который dossier уже читает (`getAttachments`, attachments.ts:27).
- Рендер из событий: есть `tasksFromEvents`/`taskDetailFromEvents`/`eventLines`
  (adapter.ts); `taskPack`/`taskPackByLoomId` рендерят через CLI `pack` (cwd-проект).

---

## Граф зависимостей

```
S1 ─┬─> S2 ─┬─> S3
    │       └─> S5 ─> S6
    └─> S4
S2,S3,S4,S5,S6 ─> S7
```

---

## S1 — Хелпер чтения+рендера журнала проекта (адаптер)

- Реализуется: в `adapter.ts`
  - `exportEventsSafe(projectRoot): TjEvent[]` — try/catch-обёртка над существующим
    `exportEvents` (`adapter.ts:74`), `[]` при ошибке/пустом проекте.
  - `boardTaskJournal(projectRoot, mode="full"): string` — рендер markdown-пака из
    событий проекта (worktree 1:1 с задачей → берём все задачи проекта/последнюю),
    используя `tasksFromEvents`/`taskDetailFromEvents`/`eventLines`. `""` если событий нет.
- Файлы: `src/core/plugins/task-journal/adapter.ts`,
  `test/core/plugins/task-journal/*` (новый тест).
- Критерий готовности: unit-тест на временной `TASK_JOURNAL_DATA_DIR` —
  проект с decision/finding/rejection → строка содержит их; пустой проект → `""`;
  ошибка CLI не пробрасывается.

## S2 — `journalProjectRoot` + переключение dossier на чтение журнала (api)

- Реализуется:
  - `journalProjectRoot(task)`: git-репо → `worktreePath(id)`; non-git репо →
    `resolveProjectRoot(repo)`; без репо → `resolveProjectRoot(process.cwd())`
    (совпадает с логикой `taskCwd`, api.ts:297).
  - В эндпоинте `/api/tasks/:id/dossier` (api.ts:1039–1056) заменить
    `taskPackByLoomId(root,id)` на `boardTaskJournal(journalProjectRoot(task))`.
    `renderDossier(stages/costs/attachments/diff)` не трогаем.
- Файлы: `src/web/api.ts`, `test/web/api.test.ts`.
- Критерий готовности: api-тест — у задачи с worktree-проектом, где есть события,
  dossier.pack содержит рассуждения; без журнала — секция пустая, ответ 200.

## S3 — Снапшот журнала на Done + фоллбэк при чтении (персистентность)

- Реализуется:
  - На Done (`runDone`/закрытие, путь `deps.closeTask` или рядом, api.ts:117/564)
    best-effort: `export` журнала из `journalProjectRoot(task)` и сохранить
    `saveResult(id, "memory", "journal-snapshot", { events })`.
  - Чтение (S2 и Memory): сперва live-`export`; если пусто — взять снапшот из
    attachment-store и отрендерить `boardTaskJournal`-логикой из сохранённых событий.
- Файлы: `src/web/api.ts` (+ маленький read-хелпер), `test/web/api.test.ts`.
- Критерий готовности: тест — после «удаления» worktree (инъекция: live-export даёт
  пусто) dossier всё равно возвращает журнал из снапшота.

## S4 — Привязка внешней ссылки `loom:<id>` (прослеживаемость)

- Реализуется:
  - `bindExternal(projectRoot, tjId, ref)` в адаптере — обёртка над
    `task-journal external --add <ref> <tjId>` (cwd=projectRoot), best-effort.
  - На Done: для задач(и) worktree-проекта проставить `loom:<board-id>`.
- Файлы: `src/core/plugins/task-journal/adapter.ts`, `src/web/api.ts`,
  соответствующие тесты.
- Критерий готовности: тест — хелпер вызывается с `loom:<id>`; ошибка проглатывается;
  не ломает Done. (Не load-bearing для отображения.)

## S5 — Memory-секция: борд-задачи ↔ их журналы (сервер + клиент-API)

- Реализуется:
  - Источник списка Memory = борд-задачи Loom (БД, как основной список задач), а не
    tj-задачи main-проекта.
  - Detail/pack борд-задачи = `boardTaskJournal(journalProjectRoot(task))` со снапшот-
    фоллбэком (переиспользовать S2/S3). Эндпоинт: переиспользовать dossier-механизм
    либо добавить `/api/memory/board/:id` (решить на impl, без дублей).
  - Убрать выдачу сырых `tj-xxx` main-проекта из Memory.
- Файлы: `src/web/api.ts`, `web/src/api.ts` (клиент), `test/web/api.test.ts`,
  `test/web/client.test.ts`.
- Критерий готовности: тест — список Memory = борд-задачи (нет `tj-xxx` main);
  выбор задачи → её журнал; промаха проектов нет.

## S6 — Memory UI (компонент)

- Реализуется: `web/src/components/Memory.tsx` — список борд-задач (заголовок,
  `t-xxx`, статус), клик → markdown-пак журнала борд-задачи; пустое состояние как сейчас.
  UI на английском. Стили строго по дизайн-системе (переиспользовать
  `split/list/detail/mem-pack/chip`).
- Файлы: `web/src/components/Memory.tsx` (+ типы в `web/src/api.ts` при необходимости).
- Критерий готовности: `npm run check:ds` зелёный; `tsc` зелёный; визуально список =
  борд-задачи, деталь = журнал.

## S7 — Верификация и зачистка

- Реализуется: полный `tsc`, существующие тесты, `npm run check:ds`. Через `find_usages`
  убрать ставший неиспользуемым `taskPackByLoomId`; поправить вводящие в заблуждение
  комментарии («auto-bound by the MCP», adapter.ts:134 / api.ts:1038).
- Файлы: затронутые из S1–S6.
- Критерий готовности: всё зелёное; мёртвых ссылок нет; комментарии соответствуют коду.

---

## Открытые вопросы к impl (из рисков SDD)

- R2: момент привязки `external --add` — на Done задача агента в worktree-проекте уже
  существует; подтвердить на реальном прогоне.
- R3: если в worktree-проекте несколько tj-задач — рендерить все/последнюю; привязка
  `loom:<id>` помогает фильтровать.
- R5: подтвердить флаги CLI на версии task-journal в окружении прогона.
