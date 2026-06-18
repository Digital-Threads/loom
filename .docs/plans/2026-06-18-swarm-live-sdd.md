# SDD — Оживить вкладку Swarm (loom-host/web)

- **Дата:** 2026-06-18
- **Задача (journal):** tj-swsqgews5d
- **Класс:** feature (превратить статичную заглушку в живой компонент)
- **Область:** только пакет loom-host. Правки общего кода — аддитивные. Другие пакеты не трогаем.

## 1. Цель

Сейчас `web/src/components/Swarm.tsx` — статичная «визитка»: переданный `client` не используется
(`_props`), а «Default attempts: 3» — захардкоженный текст (Swarm.tsx:18). Нужно оживить две вещи:

1. **Default attempts** — редактируемая настройка, которая сохраняется и переживает перезагрузку
   (тот же механизм, что в `Settings.tsx`: `client.settings()` + `client.saveSetting`).
2. **История прошлых swarm-прогонов / исходов консенсуса** — список, построенный из потока событий
   проекта (`client.timeline()` → `loadEvents` на сервере), с аккуратным пустым состоянием.

## 2. Границы (что НЕ делаем)

- Не добавляем серверных эндпоинтов: `settings`, `saveSetting`, `timeline` в `createClient` уже есть.
- Не вшиваем swarm в рабочий пайплайн и **не добавляем эмиссию swarm-событий** — в хосте swarm
  нигде не прогоняется (`runSwarmStep`/`runConcurrent`/`majorityVote` встречаются только в тестах),
  места для эмиссии нет. Это за рамками «сделать Swarm.tsx живым». См. §7 (открытый вопрос).
- Не вводим новых цветов/шрифтов хардкодом — только токены и существующие классы, иначе `check:ds`
  падает. `fontSize` — только `var(--fs-*)`.
- Не добавляем новых зависимостей и абстракций. Минимум кода.

## 3. Затрагиваемые файлы

| Файл | Что меняем |
| --- | --- |
| `web/src/components/Swarm.tsx` | из stateless-визитки в компонент с `useState`/`useEffect`: читаемый/сохраняемый attempts + список прогонов из timeline |
| `web/src/components/Swarm.test.tsx` | **новый** — TDD на оба пункта (мок `client.settings/saveSetting/timeline`) |
| `web/src/api.ts` | **возможно, аддитивно**: экспорт типа swarm-события (контракт §5.3). Если хватит `TimelineEvent` — не трогаем |

Используем как есть: классы `panel`, `kv`, `chip`, `finding-list`/`finding`, `inp`, `btn`, `muted`;
компонент `StateView` (loading/error), `toast` (success/error).

## 4. Контракты API (факт из `createClient`, web/src/api.ts)

- `settings()` → `Promise<Record<string, unknown>>` (GET `/api/settings`; сервер — `getAllSettings`).
- `saveSetting(key, value)` → `Promise<{ ok: boolean }>` (POST `/api/settings`; сервер — `setSetting`,
  значение хранится JSON-кодированным в таблице `settings`).
- `timeline()` → `Promise<TimelineEvent[]>` (GET `/api/timeline`; сервер — `loadEvents`, отсортировано
  по `ts`). `TimelineEvent = { ts; source; type; taskId?; profileId?; severity?; message?; metrics? }`.

## 5. Дизайн-решения

### 5.1 Default attempts — настройка `swarm.attempts`
- Ключ настройки: `swarm.attempts`, значение — целое число, по умолчанию **3**.
- Чтение: `client.settings()` в `useEffect`, как в `Settings.tsx`. Значение
  `(s["swarm.attempts"] as number) ?? 3`.
- Редактирование: числовое поле `<input className="inp" type="number" min={1} step={1}>` с
  сохранением по `onBlur` (паттерн `cost.capUsd` в `Settings.tsx`): нормализуем
  `Math.max(1, Math.round(Number(value)) || 3)` (attempts не может быть < 1), отражаем «починенное»
  значение обратно в поле, вызываем `save("swarm.attempts", n)` → `toast.success("Saved")`,
  при ошибке `toast.error`.
- Оптимистично обновляем локальный стейт (как `setS` в Settings), чтобы chip/значение совпадали.

> Отвергнуто: отдельная кнопка «Save» — лишнее состояние; в проекте принят `onBlur`-сейв (Settings).

### 5.2 История прогонов — фильтр `timeline()` по swarm-типу
- В `useEffect` грузим `client.timeline()`, оставляем события, у которых `type` относится к swarm —
  условие: `e.type === "swarm" || e.type.startsWith("swarm.")` (и/или `e.source === "loom"` — см. 5.3).
- Рендер списком (новые сверху, `sort` по `ts` убыв.). На строку показываем:
  - исход/тип (`type` либо `message`),
  - согласие консенсуса, если есть метрики: `count/total` и `ratio` (как «agreement N%»),
  - время (локально форматированное из `ts`).
  - Переиспользуем `finding-list`/`finding`/`finding-sev`/`finding-msg` (как уже в Swarm.tsx) или
    `kv`-строки — без новых классов.
- **Пустое состояние** (сейчас так и будет — событий нет): блок `muted` с честным текстом, например
  «No swarm runs recorded yet. Runs will appear here once swarm executes within a task.»
  Не показываем ошибку — пустота это нормальное состояние.

### 5.3 Контракт swarm-события (для будущей эмиссии и фильтра)
UI рассчитан на `LoomEvent`/`TimelineEvent` вида:
- `source: "loom"`, `type: "swarm.run"` (или иной `swarm.*`),
- `metrics: { attempts, count, total, ratio }` (где `count/total/ratio` — из `Consensus` пакета
  loom-swarm), `message` — краткое описание исхода.

Если для типобезопасной фильтрации удобно — аддитивно экспортируем константу/тип в `api.ts`
(не меняя существующих контрактов). Если достаточно строкового сравнения по `TimelineEvent.type` —
`api.ts` не трогаем вовсе.

### 5.4 Состояния загрузки/ошибки
- Пока `settings()`/`timeline()` не вернулись — `StateView kind="loading"` (как в Settings).
- Ошибка загрузки настроек — `StateView kind="error"`. Ошибку `timeline()` гасим до пустого списка
  (история не критична для работы страницы), чтобы сбой ленты не ломал редактирование attempts.
- Capabilities-блок (`runConcurrent`/`majorityVote`/`successes`) и текст про пакет — **сохраняем**
  как есть (полезный контекст), меняем только статичный chip attempts и добавляем секцию истории.

## 6. План TDD (web/src/components/Swarm.test.tsx)

Мок-клиент по образцу `Knowledge.test.tsx` (`vi.fn`, `as unknown as LoomClient`).

1. **default attempts из настроек** — `settings` резолвит `{ "swarm.attempts": 5 }` → в поле/чипе
   видно `5` (а не `3`).
2. **fallback по умолчанию** — `settings` резолвит `{}` → видно `3`.
3. **сохранение attempts** — ввод нового числа + blur → `saveSetting` вызван с
   `("swarm.attempts", <n>)`; нормализация: ввод `0`/пусто/отрицательное → сохраняется `>= 1`.
4. **пустая история** — `timeline` резолвит `[]` → виден текст пустого состояния.
5. **рендер прогонов** — `timeline` резолвит массив с одним `swarm.*`-событием и одним посторонним
   → показан только swarm, с его исходом и согласием; посторонний отфильтрован.

Прогон: `cd web && npm run test`.

## 7. Открытый вопрос / риск (зафиксировано в journal)

Пакет `@digital-threads/loom-swarm` — stateless и **сам событий не пишет**; в хосте swarm к пайплайну
не подключён. Поэтому секция «история прогонов» технически корректна, но **будет пустой**, пока
кто-то не начнёт эмитить swarm-события в общий поток (`loadEvents`). В рамках этой задачи (self-contained,
«оживить Swarm.tsx») мы готовим UI и контракт события (§5.3), но саму эмиссию НЕ добавляем — это
отдельная работа по вшиванию swarm в рабочий цикл. Если ревью решит, что «история» обязана наполняться
сейчас, это расширяет scope за пределы web-компонента.

## 8. Критерии приёмки

- [ ] Default attempts читается из настройки `swarm.attempts` (default 3) и сохраняется (переживает
  перезагрузку), нормализован к целому `>= 1`.
- [ ] Секция истории строит список из `client.timeline()`, фильтруя swarm-события; при отсутствии —
  понятное пустое состояние (без ошибки).
- [ ] `client` реально используется (нет `_props`); существующие capabilities-блок и текст сохранены.
- [ ] UI на английском; только токены/классы дизайн-системы — `npm run check:ds` зелёный.
- [ ] Новые тесты `Swarm.test.tsx` зелёные; существующие web/host тесты не сломаны.
- [ ] `tsc` для web и host зелёные. Правки общего кода (если были) — только аддитивные.
