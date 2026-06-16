# SDD — Удаление задачи в loom-host

**Дата:** 2026-06-16
**Класс:** feature (фулл-стек, аддитивно)
**Цель:** дать пользователю возможность удалить задачу целиком — со всеми связанными строками в БД — и убрать её карточку с доски.

---

## 1. Проблема и контекст

Сейчас задачу можно создать, открыть и двигать по доске, но **удалить нельзя**. Нет ни функции в сторе, ни эндпоинта, ни кнопки. Нужна сквозная цепочка: БД → HTTP → клиент → UI.

При удалении задачи у неё есть «хвосты» в дочерних таблицах. По схеме `src/core/store/schema.ts` на `tasks(id)` ссылаются **семь** таблиц:

| Таблица | Назначение |
|---|---|
| `stages` | стадии маршрута задачи |
| `steps` | шаги плана |
| `runs` | запуски агента |
| `cost_rollups` | агрегаты стоимости (в ТЗ названо «cost») |
| `artifacts` | артефакты стадий (spec, plan, pr-description…) |
| `chat_messages` | переписка brainstorm |
| `attachments` | вложения задачи |

> ТЗ перечисляет `stages, steps, artifacts, runs, cost`. Берём **все семь**, иначе после удаления останутся сироты в `chat_messages` и `attachments`, плюс риск нарушить внешние ключи.

## 2. Объём работ (scope)

**Входит:**
- `deleteTask(db, id)` в сторе — атомарное удаление задачи и всех её детей.
- `DELETE /api/tasks/:id` — 200 `{ok:true}` либо 404.
- Клиентский метод `deleteTask(id)` + хелпер `deleteJson`.
- Кнопка-корзина с подтверждением на карточке доски, обновление доски после удаления.
- Тесты: стор (2 кейса) + web (2 кейса).

**Не входит (вынесено в открытые вопросы):**
- Остановка живого процесса/стрима задачи при удалении.
- Каскад на уровне SQLite (`ON DELETE CASCADE`) — таблицы созданы без него, менять схему не будем.
- Undo / корзина / мягкое удаление.

## 3. Дизайн

### 3.1 Backend — стор

Файл: `src/core/store/db.ts` (рядом с `createTask`/`getTask`).

```ts
export function deleteTask(db: Database.Database, id: string): boolean {
  const tx = db.transaction((taskId: string) => {
    // сначала дети, потом родитель — иначе повиснут FK-ссылки
    db.prepare("DELETE FROM stages       WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM steps        WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM runs         WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM cost_rollups WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM artifacts    WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM chat_messages WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM attachments  WHERE task_id = ?").run(taskId);
    const res = db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    return res.changes > 0;
  });
  return tx(id);
}
```

Замечания:
- `db.transaction(...)` из better-sqlite3 — синхронная, всё или ничего. Уже используется в проекте.
- Возврат `true/false` определяется `res.changes` от `DELETE FROM tasks` (была строка или нет).
- На несуществующем `id` дочерние DELETE безвредны (0 строк), `tasks` тоже 0 → возвращаем `false`.

### 3.2 Backend — эндпоинт

Файл: `src/web/api.ts`, внутри `createApi`, в секции mutations (рядом с `POST /api/tasks`).

```ts
app.delete("/api/tasks/:id", (c) => {
  const id = c.req.param("id");
  const ok = deleteTask(db, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
```

- Образец 404 взят из `GET /api/tasks/:id` (L575): `{ error: "not found" }`, статус 404.
- `deleteTask` добавить в импорт из `../core/store/db.js`.

### 3.3 Frontend — клиент

Файл: `web/src/api.ts`.

Новый хелпер по образцу `getJson`/`postJson` (L79–93):

```ts
async function deleteJson<T>(path: string, f: Fetcher): Promise<T> {
  const res = await f(path, { method: "DELETE" });
  if (!res.ok) throw onHttpError(path, res.status);
  return (await res.json()) as T;
}
```

Метод в `createClient` (рядом с `create`, L160):

```ts
deleteTask: (id: string) =>
  deleteJson<{ ok: boolean }>(`${base}/api/tasks/${id}`, f),
```

### 3.4 Frontend — UI (карточка доски)

Файл: `web/src/components/Board.tsx`. Отдельного `BoardCard.tsx` нет — карточка нарисована инлайн как `<div className="card">` (L64–81). Кнопку-корзину добавляем туда.

Поведение:
- Кнопка `🗑` в карточке. `onClick` → `e.stopPropagation()` (чтобы не открыть задачу) → `window.confirm("Удалить задачу?")`.
- При подтверждении: `client.deleteTask(card.id)` → затем `client.board().then(setCols)` (тот же приём обновления, что в `onDrop`).
- Ошибку показываем через `toast.error(...)`, как в существующем `onDrop`.

Эскиз:

```tsx
function onDelete(id: string, e: React.MouseEvent) {
  e.stopPropagation();
  if (!window.confirm("Удалить задачу? Это действие необратимо.")) return;
  client
    .deleteTask(id)
    .then(() => client.board().then(setCols))
    .catch((er) => toast.error(`Не удалось удалить задачу: ${er}`));
}
```

В разметке карточки — кнопка с `onClick={(e) => onDelete(card.id, e)}`.

## 4. Тесты (TDD — пишем первыми)

### 4.1 Стор — `test/core/store/store.test.ts`

Стиль файла: vitest, `openStore` на временной БД (`mkdtempSync`), `createTask`.

1. **Удаляет задачу и связанные строки.**
   - `createTask(db, {id:"d1", title:"X"})` (создаёт ещё и stages).
   - Опционально досеять ребёнка (например `createStep`) для наглядности.
   - `expect(deleteTask(db, "d1")).toBe(true)`.
   - `expect(getTask(db, "d1")).toBeUndefined()`.
   - `expect(getStages(db, "d1")).toHaveLength(0)` — хвосты исчезли.

2. **Несуществующая задача → false.**
   - `expect(deleteTask(db, "nope")).toBe(false)`.

### 4.2 Web — `test/web/api.test.ts`

Стиль: `app.request(path, {method})`, хелпер `json(path)`.

1. **DELETE существующей → 200 и исчезает из списка.**
   - В `beforeEach` уже есть задача `t1`.
   - `const res = await app.request("/api/tasks/t1", { method: "DELETE" })` → `status 200`, body `{ ok: true }`.
   - `await json("/api/tasks")` → в `body.tasks` нет `t1`.

2. **DELETE неизвестного id → 404.**
   - `app.request("/api/tasks/zzz", { method: "DELETE" })` → `status 404`.

## 5. Риски и открытые вопросы

- **Живая сессия задачи.** Если у задачи есть запущенный процесс/стрим (`streamSinks` в api.ts), удаление из БД его не остановит. На этом шаге не трогаем; кандидат в отдельную задачу (side-quest).
- **Имя таблицы стоимости** — `cost_rollups`, не `cost`. Учтено.
- **Порядок удаления** — дети перед родителем, иначе FK-ссылки повиснут. Учтено в транзакции.
- **`window.confirm` в тестах фронта.** UI-тесты карточки (если будут) должны мокать `confirm`; основной тест-фокус — стор и API.

## 6. Критерии приёмки

- [ ] `deleteTask` удаляет задачу и все 7 видов дочерних строк одной транзакцией; `true` если была, `false` если нет.
- [ ] `DELETE /api/tasks/:id`: 200 `{ok:true}` для существующей, 404 для отсутствующей; после удаления задача пропадает из `GET /api/tasks`.
- [ ] Клиент `deleteTask(id)` шлёт DELETE-запрос.
- [ ] На карточке доски есть кнопка-корзина с подтверждением; после удаления карточка исчезает (доска перезагружается).
- [ ] Все новые тесты зелёные; `tsc` без ошибок; существующие тесты не сломаны.

## 7. План реализации (порядок)

1. Тест стора (red) → `deleteTask` (green).
2. Тест web (red) → роут `DELETE` (green).
3. Клиент: `deleteJson` + `deleteTask`.
4. UI: кнопка-корзина в `Board.tsx`.
5. Прогон `tsc` + весь набор тестов → зелёно.
