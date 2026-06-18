# SDD — Полировка раздела Memory (web)

- **Дата:** 2026-06-18
- **Класс:** chore (визуальная полировка, без изменения данных и логики)
- **Файл фичи:** `web/src/components/Memory.tsx`
- **Журнал задачи:** tj-2ccs6ad6tg

---

## 1. Цель

Сделать раздел **Memory** читаемее, не трогая загрузку данных. Раздел показывает
журнал размышлений агента по борд-задачам: слева список задач, справа —
markdown-отчёт по выбранной задаче (`## Summary / ## Changes / ## Why this
approach / ## Verification / ## Affected`).

Три улучшения:
1. Чёткая шапка над отчётом: название задачи + статус-чип + проект (если проектов > 1).
2. Сканируемая типографика секций отчёта; длинный контент скроллится в правой панели.
3. Статус-чипы нужного цвета в левом списке + бóльшая плотность строк.

## 2. Что сохраняем без изменений (инварианты)

- Загрузка списка через `client.tasks()` (`useEffect`, строки 18–20).
- Загрузка отчёта через `client.boardJournal(sel)` (`useEffect`, строки 22–27).
- Состояния `loading / empty / error` для списка и для правой панели (через `<StateView>`).
- Рендер отчёта через `<Markdown text={pack} />`.
- UI на английском.

## 3. Ограничения дизайн-системы (страж `npm run check:ds`)

Проверяется `web/scripts/check-design-system.mjs`:
- В `.tsx` запрещены инлайн `color` / `background` и `fontSize: <число>`.
- Запрещён хардкод-hex (кроме узкого allowlist) и `font-family` без `var(--font-…)`.
- Размеры шрифта в компонентах — только `var(--fs-*)`.

Следствие: вся новая стилизация — **классами в `web/src/styles.css` на токенах**.
В `.tsx` допустимы только инлайн-`margin` (отступы страж не проверяет), но новые
правила выносим в классы. Цвета берём из существующих токенов
`var(--run/--wait/--done/--fail)` и переменных панелей.

## 4. Текущее состояние (факты из кода)

- `Memory.tsx` — 68 строк, проп только `{ client }`. Шапки нет: имя задачи видно
  лишь внутри markdown.
- Левый чип: `chip ${t.status === "done" ? "ok" : ""}` — цвет только для `done`,
  остальные серые. Нужно заменить на температурный `statusClass(t.status)`.
- `ui.ts`: `statusLabel(status)` → человекочитаемая метка; `statusClass(status)` →
  класс `run | wait | done | fail | ""`.
- Эталон чипа со статусом и проектом — `Board.tsx:162-168`:
  `<span className={chip ${statusClass}}><span className="dotc"/>{statusLabel}</span>`
  и `{projects.length > 1 && projName(id) ? <span className="chip proj">…}`.
- `TaskRow` имеет `project_id?: string | null`. `ProjectEntry` — `{ projectId, name }`.
- `App.tsx` уже держит `projects` в состоянии (строка 68) и передаёт их в `Board`
  (строка 137). В `Memory` (строка 145) сейчас не передаёт.
- Markdown-рендерер (`Markdown.tsx`) превращает `## Heading` в `h4.md-h`
  (`.md-h` = 13px, `font-weight:650`). Глобально менять нельзя — заденет другие
  экраны. Стилизуем scoped-правилом внутри `.mem-pack`.
- Готового CSS `.mem-pack` нет (только className). Релевантные классы:
  `.split` (65), `.list` (67–73), `.detail` (69), `.mem-row-meta` (76–77),
  `.chip.*` темп-цвета (175–179), `.md-h/.md-p/.md-list` (426–429).
- Теста для `Memory` в `test/web/` нет.

## 5. Дизайн решения

### 5.1 Источник имени проекта — проп `projects` из App

`Memory` получает новый необязательный проп `projects?: ProjectEntry[]` (по
умолчанию `[]`), как `Board`. App передаёт уже загруженные `projects`.

- **Почему так:** консистентно с `Board`, без дублирующего запроса к API.
- **Альтернатива (отклонена):** `client.projects()` внутри `Memory` — лишний
  сетевой запрос и своё состояние loading/err ради одной строки текста.
- Имя проекта: `projects.find(p => p.projectId === sel.project_id)?.name`.
  Чип проекта показываем только при `projects.length > 1` и наличии имени —
  ровно как в `Board`.

### 5.2 Шапка выбранной задачи

Рендерится в правой панели **только когда задача выбрана** (`sel` найдена в
`tasks`). При `loading / empty / error` правой панели — шапку не показываем,
оставляем текущие `<StateView>`.

Структура (классы новые, разметка без инлайн-стилей):
```
<div className="mem-head">
  <h2 className="mem-title">{task.title}</h2>
  <div className="mem-head-meta">
    <span className={`chip ${statusClass(task.status)}`}>
      <span className="dotc" />{statusLabel(task.status)}
    </span>
    {projects.length > 1 && projName ? <span className="chip proj">{projName}</span> : null}
  </div>
</div>
```

Под шапкой — прежний `<div className="mem-pack"><Markdown text={pack} /></div>`.
Шапка остаётся видимой, а отчёт скроллится (см. 5.4).

`task` берём из уже загруженного списка: `tasks.find(t => t.id === sel)`.
Новых запросов нет.

### 5.3 Левый список — статус-чип + плотность

- Заменить `chip ${t.status === "done" ? "ok" : ""}` →
  `chip ${statusClass(t.status)}` + `<span className="dotc" />` + `statusLabel(t.status)`
  (единый вид со всем приложением, температурные цвета).
- Плотность: подправить отступы строк списка через классы в `styles.css`
  (`.list button` паддинги/`gap`), без изменения логики.

### 5.4 Типографика секций и скролл (CSS, scoped)

Все правила — внутри `.mem-pack` / `.mem-head`, чтобы не задеть другие экраны:
- `.mem-head` — отделение шапки от отчёта (нижняя граница/отступ), `.mem-title`
  размер через `var(--fs-*)`, `.mem-head-meta` — флекс-ряд с чипами.
- `.mem-pack .md-h` — заголовки секций сканируемые: размер `var(--fs-*)`, вес,
  верхний отступ для ритма (первый без лишнего отступа через `:first-child`).
- Скролл: правая панель `.detail` фиксированной высоты, шапка не скроллится,
  `.mem-pack` получает `overflow:auto` с `max-height` (или панель — флекс-колонка
  с растущим скроллируемым `.mem-pack`). Размеры — токены/px-spacing по house style;
  цвета/шрифты — токены.

## 6. План правок (файлы)

1. `web/src/components/Memory.tsx`
   - добавить импорт `statusLabel, statusClass` из `../ui` и тип `ProjectEntry`;
   - проп `projects?: ProjectEntry[]` (default `[]`);
   - левый чип → `statusClass` + `dotc` + `statusLabel`;
   - блок `.mem-head` в правой панели при выбранной задаче.
2. `web/src/App.tsx`
   - `<Memory client={client} projects={projects} />`.
3. `web/src/styles.css`
   - новые классы: `.mem-head`, `.mem-title`, `.mem-head-meta`,
     `.mem-pack` (скролл), `.mem-pack .md-h` (типографика);
   - уплотнение `.list button` при необходимости.
4. `test/web/memory.test.tsx` (новый, если уместно)
   - рендер шапки и статус-чипов; состояния loading/empty/error не сломаны.

## 7. Критерии приёмки

- [ ] Над отчётом видна шапка: название задачи + статус-чип нужного цвета
      (running/waiting/done/failed) + чип проекта при `projects.length > 1`.
- [ ] Заголовки секций отчёта (Summary/Changes/Why/Verification/Affected)
      визуально выделены и сканируемы; длинный отчёт скроллится, шапка остаётся.
- [ ] В левом списке у каждой задачи статус-чип своего цвета; строки плотнее.
- [ ] Загрузка списка, `boardJournal`, состояния loading/empty/error работают как прежде.
- [ ] Нет инлайн-стилей с хардкод-цветами/шрифтами; `fontSize` только `var(--fs-*)`.
- [ ] `npm run check:ds` — зелёный.
- [ ] `tsc -b` (web) — без ошибок.
- [ ] Существующие тесты не падают; добавленный тест Memory зелёный.
- [ ] UI на английском.

## 8. Риски

- Scoped-правило `.mem-pack .md-h` не должно влиять на markdown в других местах —
  держать селектор под `.mem-pack`.
- Скролл: высота `.detail` зависит от родительской раскладки `.split`; проверить,
  что панель не схлопывается и не растягивает страницу. Проверка визуально/в тесте.
- Передача `projects` в `Memory` — единственное отклонение от «только client»;
  оно аддитивно (новый необязательный проп), инварианты не нарушает.
