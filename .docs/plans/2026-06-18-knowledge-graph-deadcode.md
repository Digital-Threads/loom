# SDD — Убрать мёртвый эндпоинт `/api/knowledge/graph` + host-импорт `buildGraph`

- **Дата:** 2026-06-18
- **Область:** только `loom-host`
- **Класс:** chore (уборка мёртвого кода)
- **Задача journal:** tj-hxawbnm57y

## 1. Контекст и проблема

В loom-host зарегистрирован серверный эндпоинт `GET /api/knowledge/graph`
(`src/web/api.ts:1163`). Он берёт recall-хиты и прогоняет их через `buildGraph(...)`,
отдавая граф `{ nodes, edges }`.

Этот эндпоинт **никто не вызывает**:

- Веб-клиент `web/src/api.ts` умеет только `recall` (`:241`) и `search` (`:246`).
  Метода для `/graph` там нет.
- Экран «Knowledge» `web/src/components/Knowledge.tsx` строит свой «reasoning graph»
  локально из recall-хитов — функцией `chainsFromHits` (`:19`), без второго запроса
  на сервер.

`find_usages("buildGraph")` по host даёт ровно два совпадения: импорт `src/web/api.ts:38`
и вызов `src/web/api.ts:1165`. Больше нигде в host не используется.

## 2. Решение (выбранный вариант)

**Удалить мёртвый host-код**: эндпоинт + импорт `buildGraph` + host-тест этого эндпоинта.

### Почему не «подключить серверный граф к UI»

Серверный `buildGraph` **не богаче** клиентского построения. Сравнение по коду:

- Серверный `buildGraph` (пакет `@digital-threads/loom-knowledge`, `src/graph.ts:33`,
  host лишь реэкспортирует через `src/core/knowledge/recall.ts`): один узел на хит
  (kind `decision`/`rejection`/`other`) + явные рёбра между хитами одной задачи по порядку.
- Клиентский `chainsFromHits` (`Knowledge.tsx:19`): группирует те же хиты по задаче
  в цепочки — те же данные, та же последовательность, отрисованные как цепочки.

Подключение серверного `/graph` дало бы лишний round-trip и переделку рабочего экрана
ради нулевой функциональной выгоды. Удаление — чисто, без dead code.

### Что НЕ трогаем

- Пакет `@digital-threads/loom-knowledge` (`graph.ts`, `buildGraph`) и его собственные
  тесты — остаются как есть. Чужой/общий код не ломаем, правки только аддитивны.
- Эндпоинты `/api/knowledge/recall` и `/api/knowledge/search` — рабочие, не затрагиваются.
- UI (`Knowledge.tsx`, `web/src/api.ts`) — не меняется, граф уже строится клиентски.

## 3. Изменения (точечно)

| # | Файл | Что | Сейчас |
|---|------|-----|--------|
| 1 | `src/web/api.ts:38` | Убрать `buildGraph` из списка импорта | `import { recallPrior, partitionHits, buildGraph, askSearch, type RecallHit } from "../core/knowledge/recall.js";` |
| 2 | `src/web/api.ts:1162–1166` | Удалить блок регистрации эндпоинта `/api/knowledge/graph` (комментарий L7.3 + `app.get(...)`) | см. ниже |
| 3 | `test/web/api.test.ts:237–247` | Удалить `it("GET /api/knowledge/graph derives nodes/edges ...")` | тест дёргает удаляемый маршрут |

Блок к удалению в `api.ts`:

```ts
// L7.3 — problem→solution graph derived from recall hits.
app.get("/api/knowledge/graph", (c) => {
  const q = c.req.query("q") ?? "";
  return c.json(buildGraph(q ? recall(q) : []));
});
```

После правки #1 импорт принимает вид:

```ts
import { recallPrior, partitionHits, askSearch, type RecallHit } from "../core/knowledge/recall.js";
```

## 4. Порядок работ

Это удаление, а не добавление поведения, поэтому классический TDD «сначала падающий
тест» неприменим — тестируемого нового поведения нет. Действуем как с dead code:

1. Удалить host-тест эндпоинта (`test/web/api.test.ts:237–247`).
2. Удалить блок эндпоинта (`api.ts:1162–1166`).
3. Убрать `buildGraph` из импорта (`api.ts:38`).
4. Прогнать проверки (раздел 5).

## 5. Критерии приёмки (проверяемые)

- [ ] `find_usages("buildGraph")` по host больше не находит ни импорта, ни вызова
      (совпадения остаются только внутри пакета `loom-knowledge`).
- [ ] tsc host зелёный (нет «unused import» / «cannot find name buildGraph»).
- [ ] tsc web зелёный (web не затрагивался — контрольная проверка).
- [ ] Host-тесты зелёные; тест `/api/knowledge/graph` отсутствует, остальные knowledge-тесты
      (`recall`, `search`) проходят без изменений.
- [ ] `npm run check:ds` зелёный (UI не менялся; новых инлайн-цветов/шрифтов нет).
- [ ] Тесты пакета `loom-knowledge` (`buildGraph`) не затронуты и проходят.

## 6. Риски и заметки

- **Низкий риск.** Удаляется код, который не вызывается ни клиентом, ни другими модулями host.
- Висячий тест на удалённый маршрут покраснел бы — поэтому тест удаляется в одном изменении
  с эндпоинтом (шаги 1–2 неразделимы по смыслу).
- В `.docs/plans/2026-06-17-knowledge.md` есть упоминание `/graph`/`buildGraph` (строки 39, 132) —
  это исторический план-документ, не код; правкам не подлежит, оставляем как есть.
- Реэкспорт `buildGraph` через `src/core/knowledge/recall.ts` (`export * from "@digital-threads/loom-knowledge"`)
  остаётся: это весь публичный API пакета, сужать его не нужно.
