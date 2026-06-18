# SDD — Кликабельные карточки в разделе Layers

Дата: 2026-06-18
Статус: spec
Задача: сделать карточки слоёв в разделе **Layers** кликабельными — клик по слою, у
которого есть собственный раздел в меню, переключает на этот раздел. Hover/active —
по дизайн-системе. Тесты на маппинг «слой → раздел».

---

## 1. Контекст и проблема

Раздел **Layers** (`web/src/components/Layers.tsx`) сейчас — статичный справочник.
Он показывает все слои архитектуры Loom двумя группами: «Standalone plugins» и
«Inline modules». Каждая карточка — это `<div className="layer-row">` без обработчиков:
по ней нельзя кликнуть, она ничего не делает.

При этом многие слои **уже имеют свой раздел** в левом меню (Security, Quality, Swarm,
Knowledge, Accounts, Tokens, Memory). Пользователь, увидев слой в каталоге, ожидает
перейти в его раздел кликом — но такой связи нет.

Цель: карточка слоя, у которого есть раздел, ведёт себя как пункт меню — клик
открывает соответствующий раздел. Карточки без раздела остаются статичными.

## 2. Что уже есть в коде (факты)

- **Источник данных:** `src/core/dashboard/layer-catalog.ts` → `LAYER_CATALOG`.
  У каждого слоя есть `id`. Значения id:
  - standalone: `accounts`, `efficiency`, `memory`, `security`, `quality`, `swarm`
  - inline: `automation`, `knowledge`, `learning`, `observability`
- **API:** `GET /api/layers` (`src/web/api.ts:1205`) отдаёт поле `id` каждого слоя
  (`src/web/api.ts:1211`). Фронтовый тип `LayerInfo` (`web/src/api.ts:344`) уже
  содержит `id` — менять контракт API **не нужно**.
- **Разделы меню:** список `NAV` в `web/src/components/Sidebar.tsx`. Ключи разделов:
  `board, projects, accounts, tokens, memory, security, quality, swarm, connectors,
  knowledge, skills, layers, timeline, settings`.
- **Навигация:** функция `nav(v)` в `web/src/App.tsx:88` переключает раздел. Уже
  прокинута в `Sidebar` как проп `onNav`. В `Layers` сейчас **не прокинута** —
  компонент получает только `client`.
- **Рендер карточки:** `Layers.tsx:33`, элемент `<div className="layer-row">`.
  CSS — `web/src/styles.css:297` (`.layer-row` — рамка, паддинг, фон `var(--chip)`).
- **DS-стили для опоры:**
  - hover пункта меню: `.nav button:hover { background:var(--panel2); color:var(--txt) }`
    (`styles.css:34`)
  - активный/акцентный пункт: `background:rgba(239,177,78,.10);
    box-shadow:inset 2px 0 0 var(--filament-400)` (`styles.css:35`)
  - глобальный фокус-ринг: `:focus-visible { outline:2px solid var(--acc) }`
    (`styles.css:19`) — применяется к `button`, `a`, `[tabindex]`.
- **Стиль тестов:** `test/web/ui.test.ts` импортирует чистые функции из
  `web/src/ui.js` и проверяет их через vitest (`expect(fn(in)).toBe(out)`). Это
  целевой паттерн для тестов маппинга.

## 3. Маппинг «слой → раздел»

Связь не выводится автоматически по имени (например, слой `efficiency` ведёт в раздел
`tokens`), поэтому задаём её **явной таблицей**.

| id слоя        | раздел меню | примечание                                  |
|----------------|-------------|---------------------------------------------|
| `accounts`     | `accounts`  | standalone (aimux)                          |
| `efficiency`   | `tokens`    | standalone (token-pilot); имена не совпадают|
| `memory`       | `memory`    | standalone (task-journal)                   |
| `security`     | `security`  | standalone                                  |
| `quality`      | `quality`   | standalone                                  |
| `swarm`        | `swarm`     | standalone                                  |
| `knowledge`    | `knowledge` | inline                                      |
| `observability`| `timeline`  | inline; описание слоя — «event timeline»    |
| `automation`   | `board`     | inline; движок задач = доска/пайплайн       |
| `learning`     | — (нет)     | раздела нет → карточка некликабельна        |

Правило: функция `layerSection(id)` возвращает ключ раздела **или** `undefined`.
`undefined` ⇒ карточка остаётся статичной.

> Открытый вопрос для согласования: пары `observability→timeline` и `automation→board`
> — это интерпретация, а не очевидное соответствие. Если они нежелательны — убрать из
> таблицы, тогда эти карточки станут некликабельными. На логику не влияет: таблица
> правится в одном месте, тест обновляется следом.

## 4. Дизайн решения

### 4.1 Новый модуль `web/src/layers.ts`
Чистая функция без зависимостей от React и DOM:

```ts
// Карта «id слоя → ключ раздела меню». Заполняется только теми слоями, у которых
// есть собственный пункт в Sidebar NAV. Остальные не кликабельны.
export const LAYER_SECTION: Record<string, string> = {
  accounts: "accounts",
  efficiency: "tokens",
  memory: "memory",
  security: "security",
  quality: "quality",
  swarm: "swarm",
  knowledge: "knowledge",
  observability: "timeline",
  automation: "board",
};

/** Раздел меню для слоя, либо undefined если у слоя нет своего раздела. */
export function layerSection(id: string): string | undefined {
  return LAYER_SECTION[id];
}
```

Почему отдельный модуль, а не внутри `Layers.tsx`: чтобы маппинг тестировался
изолированно (как `ui.ts`), без рендера React.

### 4.2 Прокидывание навигации в `Layers`
- `App.tsx`: при рендере `<Layers client={client} />` добавить проп `onNav={nav}`.
- `Layers.tsx`: компонент принимает `onNav: (v: string) => void`, передаёт его в
  `Group`, а `Group` — в рендер карточки.

### 4.3 Рендер карточки
Для каждого слоя вычисляем `const section = layerSection(l.id)`.
- **Если `section` задан** — карточка интерактивна: кликом вызывает `onNav(section)`.
  Чтобы работала клавиатура и фокус-ринг, элемент должен быть настоящей кнопкой
  (`<button type="button">`) либо `div` с `role="button"`, `tabIndex={0}` и
  обработчиком Enter/Space. Предпочтительно `<button>` — фокус-ринг уже покрыт
  глобальным `:focus-visible`. Добавляем класс-модификатор `layer-row-link` (или
  `is-clickable`) и атрибут `aria-label`/`title` вида «Open <раздел>».
- **Если `section` нет** — рендерим как сейчас (`<div className="layer-row">`),
  без обработчиков и без курсора-указателя.

### 4.4 CSS (hover/active по DS)
В `web/src/styles.css` рядом с `.layer-row` добавить модификатор для кликабельной
карточки. Сбросить дефолтные стили кнопки (`button` имеет свой фон/паддинг) и повторить
поведение пунктов меню:

```css
.layer-row-link{
  cursor:pointer; width:100%; text-align:left; font:inherit; color:inherit;
  /* фон/рамка/паддинг наследуются от .layer-row, если применять оба класса */
  transition:background .12s, border-color .12s;
}
.layer-row-link:hover{ background:var(--panel2); border-color:var(--filament-400) }
.layer-row-link:active{ background:rgba(239,177,78,.10) }
```

Фокус-ринг отдельно описывать не нужно — глобальный `:focus-visible` (styles.css:19)
сработает на `<button>`. Точные токены при импле уточнить по факту (`--panel2`,
`--filament-400`, `--acc` уже используются в меню).

## 5. Тесты

Файл `test/web/layers.test.ts` (vitest), импорт `../../web/src/layers.js`:

1. `layerSection` возвращает верный раздел для каждого id из таблицы §3
   (точечные проверки: `accounts→accounts`, `efficiency→tokens`, `security→security`,
   `knowledge→knowledge`, `observability→timeline`, `automation→board`).
2. `layerSection("learning")` → `undefined` (слой без раздела).
3. `layerSection("неизвестный")` → `undefined`.
4. **Защита от рассинхрона:** каждый раздел из `LAYER_SECTION` существует среди ключей
   `NAV` в `Sidebar`. Если ключи `NAV` экспортируемы — проверять против них; иначе
   завести экспортируемый список ключей разделов и сверять. Это ловит опечатку/
   переименование раздела.

> Тесты на сам React-рендер (что div стал button) — необязательны; основная цель по
> ТЗ — маппинг. При желании добавить лёгкий smoke-тест клика отдельным пунктом QA.

## 6. Объём изменений

| Файл | Изменение |
|------|-----------|
| `web/src/layers.ts` | **новый** — `LAYER_SECTION` + `layerSection()` |
| `web/src/components/Layers.tsx` | проп `onNav`; вычисление `section`; кнопочный рендер кликабельных карточек |
| `web/src/App.tsx` | передать `onNav={nav}` в `<Layers>` |
| `web/src/styles.css` | стили `.layer-row-link` (hover/active по DS) |
| `test/web/layers.test.ts` | **новый** — тесты маппинга + защита от рассинхрона с NAV |
| `web/src/components/Sidebar.tsx` | *возможно* — экспортировать ключи NAV для теста §5.4 |

## 7. Критерии приёмки

- Клик по карточке слоя, имеющего раздел, переключает приложение на этот раздел
  (то же, что клик по пункту меню).
- Карточки слоёв без раздела (`learning`) не реагируют на клик и визуально не выглядят
  кликабельными.
- При наведении и нажатии кликабельная карточка подсвечивается в стиле DS; с клавиатуры
  она фокусируется (виден фокус-ринг) и срабатывает по Enter/Space.
- `layerSection` покрыта тестами (§5), включая случай «нет раздела» и защиту от
  рассинхрона с `NAV`.
- Контракт `GET /api/layers` не меняется.

## 8. Риски

- **Доступность:** если оставить `div` + `onClick` без `role`/`tabIndex` — сломается
  клавиатурная навигация. Решение: использовать `<button>`.
- **Рассинхрон маппинга с меню:** если раздел переименуют/удалят, клик уведёт в
  несуществующий раздел (откроется «coming soon»). Закрывается тестом §5.4.
- **Спорные пары** (`observability→timeline`, `automation→board`) — продуктовое
  решение, см. открытый вопрос в §3.
