# SDD — Связка task-journal ↔ борд-задача ↔ Memory (только loom-host)

- Дата: 2026-06-18
- Задача журнала: tj-8b7w3ckhkw
- Класс: feature
- Ограничение: правим **только loom-host**. `task-journal`/`claude-memory` НЕ меняем (его код можно читать и вызывать как CLI).

---

## 1. Проблема

Когда агент конвейера работает над борд-задачей `t-xxx`, он пишет свои рассуждения
(решения, находки, отклонённые варианты) в task-journal. Сейчас эти рассуждения
**нигде не видны** в Loom: и History борд-задачи, и секция Memory показывают пусто
или чужие старые записи.

### Корень (подтверждён чтением кода и экспериментами)

1. **Агент пишет «не туда».** Сессия агента запускается с рабочей директорией =
   git-worktree (`aimux-session-launcher.ts:82`, cwd = `ensureWorktree(...).path`).
   task-journal определяет «проект» по хэшу канонического пути cwd. В worktree файл
   `.git` — это указатель, и worktree становится **отдельным проектом** (свой хэш),
   не main-репо.

2. **Привязки `loom:<t-xxx>` никто не создаёт.** По всему loom-host команда
   `task-journal external --add` не вызывается нигде (проверено). Есть только чтение:
   `taskPackByLoomId` (`adapter.ts:136`, вызов из dossier `api.ts:1043`) запускает
   `task-journal pack --external loom:<id>` с cwd = main-репо. Комментарий
   «auto-bound by the MCP» неверен → History борд-задачи всегда пустой.

3. **Промах проектов при чтении.** Loom читает журнал из main-проекта
   (`memoryTask` = `taskDetail(resolveProjectRoot(process.cwd()), id)`, `api.ts:157`;
   `loadWorkspace` для Memory-списка), а события агента лежат в проекте-worktree.

### Что выяснили экспериментально (важно для решения)

- **Данные физически НЕ теряются при удалении worktree.** task-journal хранит JSONL/SQLite
  в своей центральной data-dir, ключ — хэш строки пути. После `rm -rf <worktree>`
  команда `task-journal export --project <путь-worktree>` всё ещё возвращает события
  (хэш берётся из строки пути, существование каталога не требуется).
- **Override проекта через env НЕ существует.** Чистый тест: `TASK_JOURNAL_PROJECT`
  (и `_ROOT`/`_CWD`/`ROOT`) не влияют — задача из cwd=worktree всё равно легла в хэш
  worktree. `TASK_JOURNAL_DATA_DIR` меняет только *место хранения*, не *ключ проекта*.
- **`worktreePath(taskId)` экспортируется из loom-security** (`sandbox.d.ts:9`) —
  путь worktree вычисляется детерминированно из id, **без** существования каталога.
- CLI: `external --add <ref> <tj-id>` (по cwd-проекту, без `--project`);
  `pack --external loom:<id>` (резолв по ref в cwd-проекте);
  `export --project <path> --format json` (единственная команда с override пути).
- `removeWorktree` в loom-security есть, но в loom-host **не вызывается** (сейчас
  worktree не чистится из кода Loom) — значит нельзя опираться на «хук перед удалением».

---

## 2. Цели и не-цели

**Цели**
- Журнал прогона борд-задачи `t-xxx` должен сохраняться и быть читаемым Loom даже
  после удаления worktree.
- History борд-задачи (dossier) показывает реальные рассуждения агента по этой задаче.
- Секция Memory показывает **борд-задачи ↔ их журналы**, а не сырые `tj-xxx` чужого
  (main) проекта.
- Привязка к `loom:<t-xxx>` (внешняя ссылка) проставляется для прослеживаемости.

**Не-цели**
- Не меняем task-journal/claude-memory.
- Не переносим/не дублируем события между проектами (no replay) — читаем оригиналы.
- Не вводим фоновую миграцию и не завязываемся на несуществующий хук удаления worktree.

---

## 3. Выбранный подход

**«Чтение сквозь `worktreePath` + опциональная привязка `loom:<id>`».**

Loom для любой борд-задачи знает путь её worktree через `worktreePath(id)`
(детерминирован, не требует существования каталога). Журнал агента лежит именно в
проекте этого пути и физически переживает удаление worktree. Поэтому Loom читает
журнал так: `task-journal export --project <worktreePath(id)> --format json` →
рендерит существующими хелперами адаптера (`tasksFromEvents`, `taskDetailFromEvents`,
`eventLines`). Worktree 1:1 соответствует борд-задаче, его проект выделенный, значит
**всё содержимое этого проекта принадлежит данной борд-задаче** — отдельная
фильтрация по задаче не обязательна (но привязка `loom:<id>` добавляется для явности).

### Почему так, а не иначе (взвешенные альтернативы)

| Вариант | Вердикт | Причина |
|---|---|---|
| Перенаправить журнал агента в main-проект через env | ❌ отклонён | Override проекта в task-journal отсутствует (доказано тестом). |
| Миграция событий worktree→main (export + replay через `event`) на финише | ❌ отклонён | Теряет fidelity (timestamps/types/meta/alternatives), N спавнов CLI, требует надёжного run-end хука; `removeWorktree` из кода Loom сейчас не вызывается. |
| **Чтение сквозь `worktreePath` + `export --project`** | ✅ выбран | Полная fidelity (читаем оригиналы), без replay, переживает удаление, целиком на стороне Loom. |

---

## 4. Детальный дизайн

### 4.1. Определение «проекта журнала» для борд-задачи

Новый хелпер (loom-host), который по борд-задаче выбирает корень task-journal-проекта,
в который писал агент:

```
journalProjectRoot(task):
  if task.repo && isGitRepo(task.repo):  return worktreePath(task.id)   // git → отдельный worktree-проект
  if task.repo:                          return resolveProjectRoot(task.repo) // non-git → проект репозитория
  else:                                  return resolveProjectRoot(process.cwd()) // без репо → проект хоста
```

Обоснование веток: `taskCwd` (`api.ts:297`) уже так выбирает cwd сессии — worktree для
git-репо, иначе сам репо, иначе дефолт. Корень журнала обязан совпадать с тем cwd,
под которым реально работал агент.

### 4.2. Чтение журнала борд-задачи (адаптер)

Добавить в `src/core/plugins/task-journal/adapter.ts`:

- `exportEventsFromProject(projectRoot)` — обёртка над уже существующим приватным
  `exportEvents` (он и так зовёт `export --project <root> --format json`,
  `adapter.ts:74`), но с graceful-фоллбэком на `[]` при ошибке/пустом проекте.
- `boardTaskJournal(projectRoot, mode)` — берёт события проекта и рендерит
  человекочитаемый pack теми же средствами, что уже используются для main-проекта
  (`tasksFromEvents` / `taskDetailFromEvents` / `eventLines`). Возвращает `""`,
  если событий нет (graceful «journal yet» — как сейчас у `taskPackByLoomId`).

Заменить чтение в dossier-эндпоинте (`api.ts:1043`): вместо
`taskPackByLoomId(root, id)` (pack --external из main, всегда пусто) — читать через
`journalProjectRoot(task)` + `boardTaskJournal(...)`. Остальная сборка dossier
(`renderDossier` со stages/costs/attachments/diff) не меняется.

`taskPackByLoomId` остаётся как есть (или удаляется, если станет неиспользуемым) —
решим на impl после `find_usages`.

### 4.3. Привязка `loom:<t-xxx>` (прослеживаемость, вторично)

Не нагружает рендер (worktree 1:1 с задачей), но полезна. Простейшее место —
в момент, когда сессия уже создана и worktree ещё существует: после `export` найти
задачу(и) этого проекта и проставить `external --add loom:<id> <tj-id>` с
cwd = `worktreePath(id)`. Делается best-effort; ошибка не ломает прогон.

> Решение по точному месту вызова (старт прогона vs финиш) выносится в RnD — нужно
> убедиться, что к этому моменту у проекта-worktree уже есть хотя бы одна задача
> агента. Привязка не является load-bearing для отображения.

### 4.4. Секция Memory

**Сервер.** Сейчас:
- список Memory = `ws.tasks` из `loadWorkspace` → плагин task-journal грузит
  `tasksFromEvents(loadTaskEvents(mainRoot))` (main-проект, `adapter.ts:262`);
- detail = `/api/memory/tasks/:id/pack` → `taskPack(mainRoot, id)`.

Изменения:
- Источник списка для Memory-вкладки — **борд-задачи Loom** (из БД, как в основном
  списке задач), а не tj-задачи main-проекта.
- Для выбранной борд-задачи detail/pack читается через `journalProjectRoot(task)` +
  `boardTaskJournal(...)` (тот же путь, что dossier) — т.е. реальный журнал прогона.
- Эндпоинты: переиспользовать существующий dossier-механизм либо добавить
  `/api/memory/board/:id` (решим на impl, чтобы не плодить дубли). Никаких сырых
  `tj-xxx` чужого проекта в выдаче.

**Клиент/UI (`web/src/components/Memory.tsx`).**
- Список рендерит борд-задачи: заголовок, `t-xxx`, статус.
- Клик → журнал этой борд-задачи (Markdown pack), пустое состояние — как сейчас.
- UI **на английском**. Стили строго по дизайн-системе: `npm run check:ds` зелёный
  (переиспользовать существующие классы `split`/`list`/`detail`/`mem-pack`/`chip`,
  без новых произвольных стилей).

---

## 5. Затрагиваемые файлы

- `src/core/plugins/task-journal/adapter.ts` — `boardTaskJournal`, обёртка экспорта.
- `src/web/api.ts` — `journalProjectRoot`, замена чтения в dossier (`~L1043`),
  источник Memory-списка/детали; (опц.) вызов привязки `external --add`.
- `web/src/components/Memory.tsx` (+ `web/src/api.ts` клиент) — список борд-задач,
  детали-журнал. Английский UI, дизайн-система.
- Тесты: `test/core/plugins/task-journal/*`, `test/web/api.test.ts`,
  `test/web/client.test.ts` (+ при необходимости тест компонента Memory).

---

## 6. Стратегия тестирования (TDD)

1. **adapter.boardTaskJournal** — на временной `TASK_JOURNAL_DATA_DIR` создать
   проект-worktree с событиями (decision/finding/rejection), проверить, что рендер
   содержит их; пустой проект → `""`. (Изоляция через временную data-dir и
   реальный CLI, как в существующих actions-тестах.)
2. **journalProjectRoot** — git-задача → `worktreePath(id)`; non-git → repo;
   без репо → дефолт.
3. **dossier endpoint** — задача с worktree-журналом → в ответе видны рассуждения;
   без журнала → секция пустая, эндпоинт не падает.
4. **Memory** — список = борд-задачи (не tj-xxx main); выбор задачи → её журнал.
5. **Регрессии** — не ломать текущие тесты api/client; `tsc` зелёный;
   `npm run check:ds` зелёный.

---

## 7. Риски и открытые вопросы (вход в RnD)

- **R1. Совпадение строки пути.** `worktreePath(id)` должен давать ровно тот путь,
  что был cwd агента (тот же `ensureWorktree(...).path`), иначе хэш проекта не
  совпадёт. Проверить каноникализацию (особенно для удалённого каталога).
- **R2. Место/момент привязки `external --add`.** Убедиться, что задача агента в
  проекте-worktree уже существует к моменту вызова. Иначе — привязывать на финише.
- **R3. Несколько tj-задач в одном worktree-проекте.** Маловероятно (worktree
  выделенный), но рендер должен корректно показывать все/основную. Привязка
  `loom:<id>` помогает отфильтровать при необходимости.
- **R4. Производительность.** `export` целого проекта на каждый просмотр — приемлемо
  (проект маленький, 1 задача). При желании — кэш, но не в первой версии.
- **R5. Версия CLI.** Подтвердить флаги на реальной версии task-journal в окружении
  прогона (export `--project`, external `--add`).

---

## 8. Критерии приёмки

- Для прогнанной git-борд-задачи `t-xxx` History (dossier) показывает реальные
  decisions/findings/rejections агента — в т.ч. после удаления worktree.
- Секция Memory перечисляет борд-задачи; выбор задачи открывает её журнал; сырые
  `tj-xxx` main-проекта в Memory не показываются.
- Внешняя ссылка `loom:<t-xxx>` проставлена на задаче журнала (прослеживаемость).
- task-journal не изменён. `tsc` зелёный, `npm run check:ds` зелёный, существующие
  тесты проходят, новые тесты покрывают чтение/рендер/Memory.
