# SDD — C3b/C4 money-safety: cost-cap для L4-движка

- **Дата:** 2026-06-18
- **Задача:** tj-y786thdg6s
- **Класс:** bug (money-safety, runaway-защита)
- **Область:** только loom-host

## 1. Проблема

В системе два движка, которые запускают агента и тратят деньги:

1. **Session-движок** (ручной / полуавтоматический / autopilot через живой CLI-процесс).
   После каждого этапа вызывает `recordSessionCost` (`src/web/api.ts:405-409`) и пишет
   в учёт расходов **и токены, и реальные доллары** (`spent`) с привязкой к сессии (`sessionId`).
2. **L4-движок** (spec-run: декомпозиция + headless-aimux).
   На завершении прогона вызывает `recordRunCost` (`src/core/automation/start-run.ts:77`),
   но передаёт **только токены** — без `spent` и `sessionId`.

Ограничитель бюджета (cost-cap) проверяет именно сумму в долларах: читает строку
`aimux/spent` (`src/core/pipeline/conductor.ts:84-87`, источник `src/web/api.ts:843-846`).
Эта строка пишется функцией `recordSpend` (`src/core/observability/metrics.ts:145-161`)
только когда `spent !== undefined`.

Итог: у L4-задач реальная сумма всегда `0`, поэтому **cost-cap для L4 никогда не
срабатывает** — автономная задача может тратить деньги без тормоза (runaway-риск).

## 2. Цель

Сделать так, чтобы L4-путь записывал реальный расход (`spent`) и `sessionId`
по образцу session-пути, и cost-cap одинаково срабатывал **на обоих движках**.
При этом не сломать уже работающий учёт токенов L4.

## 3. Что выяснено (факты из кода)

- `recordRunCost` (`src/core/observability/cost-recorder.ts`) уже умеет принимать
  `spent` и `sessionId` и вызывать `recordSpend`. Менять её не нужно.
- `recordSpend` пишет `aimux/spent:<sid>` плюс агрегат `aimux/spent` (накопление по
  сессиям, loom-0wrw) — ровно то, что читает cost-cap.
- `setTaskSession` (запись `tasks.session_id`) вызывается **только** из session-движка
  (`src/core/automation/task-session.ts:160`). Для чисто-L4 задачи `session_id` может
  быть пуст.
- `runProfileHeadless` (`@digital-threads/aimux`) возвращает только
  `{ exitCode, stdout, stderr }` и **не** включает `--output-format stream-json`,
  поэтому в stdout нет `total_cost_usd`. Достать $ из вывода aimux нельзя без смены
  поведения executor — это вне scope.
- Реальный $-расход доступен лишь через `costOf(sid)` session-launcher’а
  (`src/core/automation/live-session.ts:144`), как и в session-пути.

Вывод: единственный минимальный и точный источник `spent` для L4 — это
`costOf(sid)` (как в session-пути). Когда у задачи есть живая сессия — получим
реальный расход; когда сессии нет (`sid` пуст) — `spent` остаётся `undefined`,
и учёт токенов идёт как прежде (без регресса).

## 4. Решение

### 4.1 `src/core/automation/start-run.ts`

1. Импортировать `getTaskSession` из `../store/db.js`.
2. В `StartSpecRunOptions` добавить необязательное поле:
   ```ts
   /** Real per-session $ spend reader (session-launcher's costOf). Lets the L4
    *  path record `spent` so the cost-cap can trip — same as the session path. */
   costOf?: (sessionId: string) => number;
   ```
3. В completion-handler заменить строку `start-run.ts:77`:
   ```ts
   // было:
   if (ids.taskId) recordRunCost(db, ids.taskId, { tokenEvents: loadTokenEvents() });
   ```
   на:
   ```ts
   // стало: пишем и реальный $-расход + sessionId — как session-путь
   // (api.ts recordSessionCost), чтобы cost-cap сработал и на L4.
   if (ids.taskId) {
     const sid = getTaskSession(db, ids.taskId).sessionId ?? undefined;
     const spent = sid ? opts.costOf?.(sid) : undefined;
     recordRunCost(db, ids.taskId, { tokenEvents: loadTokenEvents(), spent, sessionId: sid });
   }
   ```

`tokenEvents` передаётся как раньше → учёт токенов L4 не меняется. `spent`/`sessionId`
аддитивны: `recordSpend` не зовётся, когда `spent === undefined`.

### 4.2 Проводка

`startSpecRun` сейчас в `api.ts` не вызывается (только из тестов), поэтому новый
вызов с `costOf` в `api.ts` **не добавляем** — это было бы спекулятивно и вне scope.
Поле `costOf` инжектируемо; при будущей проводке оно прокидывается так же, как в
session-пути: `costOf: (sid) => sessionLauncher.costOf?.(sid) ?? 0`.

### 4.3 Чего НЕ делаем

- Не меняем `recordRunCost`, `recordSpend`, cost-cap reader.
- Не трогаем aimux-executor и формат вывода aimux.
- Не парсим stdout.
- Не удаляем и не ослабляем существующие тесты.
- Без изменений UI/DS (правка чисто серверная).

## 5. Тесты (доказательство)

В `test/core/automation/start-run.test.ts`:

1. **L4 пишет spent при наличии сессии и costOf.**
   Задаче выставлен `session_id` (через `setTaskSession`), в опции передан
   `costOf: () => <N>`. После прогона `getCosts(db, taskId)` содержит строку
   `source="aimux", metric="spent"` со значением `N`.
2. **cost-cap триггерит на L4.**
   Тем же `spentUsd`-ридером, что и в `api.ts:843-846` (фильтр `aimux/spent`),
   проверяем: при `spent >= cap` сумма достигает порога (cap срабатывает).
3. **Регресс токенов отсутствует / нет сессии.**
   Без `session_id` (или без `costOf`) — строка `aimux/spent` не появляется, а
   `token-pilot/used`/`saved` записаны как и раньше (учёт токенов цел).

Существующий тест в `test/core/observability/cost-recorder.test.ts`
("records real spend when provided") остаётся зелёным — контракт `recordRunCost`
не изменён.

## 6. Критерии приёмки

- `recordRunCost` в L4-пути получает `spent` и `sessionId`, когда у задачи есть сессия.
- Строка `aimux/spent` появляется для L4 → cost-cap (`spentUsd`/`conductor`) срабатывает.
- Учёт токенов L4 не изменился.
- Новые тесты зелёные; существующие не тронуты.
- `tsc --noEmit` для host и web — зелёные (без доверия инкрементальному кэшу:
  `tsc -b --force` / `--noEmit`).
- `check:ds` — зелёный (правка серверная, нарушений быть не должно).

## 7. Риски

- **`sid` пуст для чисто-L4 задач** → `spent` не запишется, cap для них по-прежнему
  не сработает. Это ограничение текущей архитектуры (источника $ для headless-aimux
  нет). В рамках задачи фиксируем зеркалирование session-пути; полноценный захват
  $ для headless — отдельная задача (потребует смены формата вывода aimux).
- Минимальная поверхность изменений снижает риск регресса; токен-путь не затронут.
