# SDD — Удаление скилла + проверка notify/flow-defaults (loom-host)

- **Дата:** 2026-06-18
- **Класс:** feature (аддитивно)
- **Область:** только пакет `loom-host` (ядро `src/core`, веб-API `src/web`, фронт `web/src`)
- **Задача-журнал:** tj-essm7w9xz8

## 1. Цель

Закрыть три мелких пробела в веб-панели Loom:

1. **Удаление скилла** — у скиллов из `~/.claude/skills` есть просмотр, поиск, редактирование и ИИ-создание, но нет удаления. Добавить полную цепочку: ядро → API → клиент → UI с подтверждением.
2. **Уведомления** — убедиться, что переключатель «Notifications» реально шлёт уведомления при включении; если транспорт не сработает — провязать. (По факту транспорт уже есть — см. §6.)
3. **Flow-defaults** — по возможности вынести дефолты flow на поверхность настроек (best-effort, без риска).

## 2. Не-цели

- Никаких изменений в других пакетах (только `loom-host`, self-contained).
- Не трогаем источники скиллов кроме глобального `~/.claude/skills` (plugin/project — отдельная будущая задача).
- Не переписываем существующий механизм уведомлений и flow-config — только проверка/поверхностное вынесение.
- Никаких новых зависимостей.

## 3. Контекст (текущее состояние кода)

| Слой | Файл | Что есть сейчас |
|------|------|------------------|
| Ядро скиллов | `src/core/skills/skills.ts` | `listSkills`, `readSkill`, `writeSkill`, `generateSkill`. Защита имени `safeName` (slug, без `..` и ведущего `-`). `resolveFile` различает dir-based (`<name>/SKILL.md`) и bare (`<name>.md`). **Нет `deleteSkill`.** |
| Контракт рантайма | `src/core/runtime/agent-runtime.ts` | `interface SkillsProvider { list, read, write, generate }`. **Нет `delete`.** |
| Реализация рантайма | `src/core/runtime/claude-runtime.ts` | `skills: { list, read, write, generate }`. **Нет `delete`.** |
| Веб-API | `src/web/api.ts:1380-1398` | `GET /api/skills`, `GET/PUT /api/skills/:name`, `POST /api/skills/generate`. **Нет `DELETE`.** |
| API-клиент | `web/src/api.ts:307-311` | `skills`, `skillGet`, `skillSave`, `skillGenerate`. **Нет `skillDelete`.** |
| UI | `web/src/components/Skills.tsx` | Список + детальный вид + редактор + диалог создания. **Нет кнопки удаления.** |
| Уведомления | `web/src/components/Sidebar.tsx:21-34` | Читает `settings["notify.enabled"]`, при росте числа attention-задач шлёт browser `Notification` (запрос разрешения при `default`). |
| Flow-config | `web/src/components/Quality.tsx`, `src/web/api.ts:1401-1409` (`GET/POST /api/flow-config/:stage`, ключ `flow.${stage}`) | Стадия `qa` уже редактируется на странице Quality. |
| Тест-эталон ядра | `test/core/skills/skills.test.ts` | vitest + `mkdtempSync` как `root`, проверки list/read/write и path-traversal. |

## 4. Требование 1 — Удаление скилла (основное)

### 4.1 Ядро — `deleteSkill`

В `src/core/skills/skills.ts` добавить функцию рядом с `writeSkill`:

```ts
/** Delete a skill by name. Dir-based skills remove the whole <name>/ folder
 *  (SKILL.md plus any bundled files); a bare skill unlinks <name>.md.
 *  Returns false on a bad name or when nothing was found. */
export function deleteSkill(name: string, root = skillsRoot()): boolean {
  if (!safeName(name)) return false;
  const f = resolveFile(name, root);
  if (!f) return false;
  // dir-based → remove the containing <name>/ dir; bare → unlink the .md
  const target = f.endsWith(join(name, "SKILL.md")) ? join(root, name) : f;
  rmSync(target, { recursive: true, force: true });
  return true;
}
```

Семантика (зафиксировано в журнале):
- **kind = dir** → удаляется вся папка `<name>/` (рекурсивно): SKILL.md + бандл-ресурсы. Альтернатива «удалять только SKILL.md» отклонена — оставила бы битую папку.
- **kind = file** → удаляется `<name>.md`.
- Возврат `boolean`: `false` при невалидном имени (защита `safeName`) или если скилл не найден; `true` при успехе.
- `rmSync` уже импортируемый модуль `node:fs` (сейчас импортируются другие функции — добавить `rmSync` в импорт).

### 4.2 Контракт рантайма

В `src/core/runtime/agent-runtime.ts` → `interface SkillsProvider` добавить:
```ts
delete(name: string): boolean;
```

В `src/core/runtime/claude-runtime.ts`:
- импорт `deleteSkill` из `../skills/skills.js`;
- в объект `skills` добавить `delete: deleteSkill,`.

### 4.3 Веб-API — `DELETE /api/skills/:name`

В `src/web/api.ts` после `PUT` (строка ~1389) добавить, по образцу `PUT`/`GET`:
```ts
app.delete("/api/skills/:name", (c) => {
  const name = c.req.param("name");
  // distinguish bad-name (400) from not-found (404) so the UI can react
  if (runtime.skills.delete(name)) return c.json({ ok: true });
  return runtime.skills.read(name) === null
    ? c.json({ error: "not found" }, 404)
    : c.json({ error: "invalid name" }, 400);
});
```
Замечание: `delete` уже вернул `false` и для bad-name, и для not-found; повторный `read` различает случаи только для корректного кода ответа. Допустимо упрощение до единого 404, если так чище в ревью — финально решаем на impl, по умолчанию различаем.

### 4.4 API-клиент

В `web/src/api.ts` рядом с `skillSave` (строка ~309):
```ts
skillDelete: (name: string) =>
  postJson<{ ok: boolean }>(`${base}/api/skills/${encodeURIComponent(name)}`, {}, f, "DELETE"),
```
(использовать существующий хелпер с методом, как у `skillSave` с `"PUT"`; если `postJson` не принимает пустое тело при DELETE — проверить на impl и при необходимости использовать имеющийся `getJson`/fetch-хелпер с `method: "DELETE"`.)

### 4.5 UI — кнопка удаления с подтверждением

В `web/src/components/Skills.tsx`:
- В шапке детального вида (`skills-detail-head`, рядом с «✏ Edit») добавить кнопку «🗑 Delete» (класс `btn sm`, в режиме `editing` — скрыта).
- По клику — **модалка подтверждения** в стиле приложения (переиспользовать существующий паттерн `overlay`/`modal`/`modal-h`/`modal-b`/`modal-f`, как в `CreateSkill`), а не нативный `confirm()` — ради единого вида и дизайн-системы.
- При подтверждении: `client.skillDelete(sel)` → при успехе `toast.success`, сброс выбранного (`setSel(null)`, `setContent("")`, `setEditing(false)`), `reload()`; при ошибке `toast.error`.
- Тексты — английские (UI english).
- Кнопка удаления использует существующие классы кнопок; никаких инлайн-цветов/шрифтов, `fontSize` только через `var(--fs-*)`.

### 4.6 Тесты (TDD)

- **Ядро** (`test/core/skills/skills.test.ts`, дописать кейсы, стиль эталона с `mkdtemp root`):
  - удаляет dir-based скилл (папка `<name>/` исчезает целиком);
  - удаляет bare `.md` скилл;
  - возвращает `false` для несуществующего имени;
  - возвращает `false` и ничего не трогает для path-traversal (`../evil`);
  - после удаления `listSkills` больше не содержит имя.
- **UI** (если в проекте есть компонентные тесты для Skills — добавить): рендер кнопки Delete, открытие модалки, вызов `client.skillDelete`, обновление списка. (Если компонентного теста для Skills нет — ограничиться ядром, UI проверяется вручную; см. §7.)

## 5. Требование 2 — Уведомления (проверка)

**Факт:** транспорт уже реализован в `web/src/components/Sidebar.tsx:21-34` — при включённом `notify.enabled` и росте числа attention-задач вызывается browser `Notification`. То есть «провязка» уже есть; шаг — **верификация**, не новая фича.

Действия:
- Подтвердить вручную (см. §7), что при включённом тумблере и появлении новой attention-задачи приходит уведомление, а при выключенном — нет.
- **Известный нюанс:** `notifyOn` читается один раз; зависимости эффекта — `[client, view]`, без `notifyOn`. Возможна устаревшая ссылка (тумблер переключили, но эффект не перечитал значение до смены `view`). Если проверка покажет, что переключение не подхватывается до перезагрузки/смены экрана — минимальный фикс: добавить `notifyOn` в массив зависимостей эффекта attention. Делать **только** если проверка подтвердит проблему (surgical).
- По возможности — компонентный тест Sidebar (мок `client.settings`/`client.attention`, мок `Notification`): при `notify.enabled=false` — `Notification` не вызывается; при `true` и росте items — вызывается.

## 6. Требование 3 — Flow-defaults (best-effort)

Дефолты flow уже редактируются на странице Quality (`flow-config`, стадия `qa`). Комментарий `Settings.tsx:7` обещает вынести их в Settings «позже».

Подход (по возможности, без риска):
- Минимально — на странице Settings добавить ссылку/подсказку, ведущую на страницу Quality, где flow настраивается (никакого дублирования логики).
- Полноценное дублирование редактора flow в Settings **не делаем** — это удвоит источник правды и риск рассинхрона.
- Если вынесение не вписывается чисто в дизайн-систему/время — оставить как есть и зафиксировать в журнале (требование сформулировано как «по возможности»).

## 7. Критерии приёмки

1. `deleteSkill` есть в ядре, удаляет dir- и file-скиллы, защищён `safeName`; покрыт тестами (все зелёные).
2. `SkillsProvider.delete` объявлен в контракте и реализован в `claude-runtime`.
3. `DELETE /api/skills/:name` работает: 200 при успехе, 404 для несуществующего, 400 для невалидного имени.
4. В клиенте есть `skillDelete`; в UI — кнопка Delete с модалкой подтверждения; после удаления список обновляется и выбор сбрасывается.
5. **Уведомления:** подтверждено вручную — при включённом тумблере уведомление приходит, при выключенном — нет (при необходимости минимальный фикс зависимостей эффекта).
6. **Flow-defaults:** на поверхности Settings появилась ссылка на flow-настройки, либо обоснованно оставлено как есть (запись в журнале).
7. **Дизайн-система:** `npm run check:ds` зелёный (нет инлайн-цветов/шрифтов; `fontSize` только `var(--fs-*)`).
8. **Типы:** `tsc` зелёный для host (`npm run build:host`) и web (`web` → `typecheck`).
9. **Тесты:** `npm run test` (vitest) зелёный; существующие тесты не сломаны.
10. UI — на английском; изменения аддитивные, общий код не ломается.

## 8. Команды проверки (verification-before-completion)

```bash
npm run check:ds          # дизайн-система
npm run build:host        # tsc для ядра/сервера (host)
( cd web && npm run typecheck )   # tsc для фронта
npm run test              # vitest (ядро + компоненты)
```
Ручная проверка §5/§6: запустить панель, переключить «Notifications», создать/освободить attention-задачу; проверить кнопку удаления скилла в UI.

## 9. Риски и открытые вопросы

- **Необратимость удаления** → обязательная модалка подтверждения; серверная проверка имени уже есть (`safeName`).
- **`postJson` и метод DELETE с пустым телом** — проверить на impl, что хелпер корректно шлёт DELETE; иначе использовать прямой fetch с `method: "DELETE"`.
- **404 vs 400 в DELETE-роуте** — повторный `read` ради различения кодов; на ревью допустимо упростить до единого 404.
- **notify-фикс зависимостей** — делать только при подтверждённой проблеме, чтобы остаться хирургичным.
- **flow-defaults** — сознательно ограничиваемся ссылкой/подсказкой, чтобы не плодить второй источник правды.
- Компонентные тесты UI — добавляем только если в проекте уже есть инфраструктура для тестов Skills/Sidebar; иначе ручная проверка.

## 10. Затрагиваемые файлы (сводка)

- `src/core/skills/skills.ts` — `deleteSkill` + импорт `rmSync`.
- `src/core/runtime/agent-runtime.ts` — `delete` в `SkillsProvider`.
- `src/core/runtime/claude-runtime.ts` — `delete: deleteSkill` + импорт.
- `src/web/api.ts` — роут `DELETE /api/skills/:name`.
- `web/src/api.ts` — `skillDelete`.
- `web/src/components/Skills.tsx` — кнопка Delete + модалка подтверждения.
- `web/src/components/Settings.tsx` — (best-effort) ссылка на flow-настройки.
- `web/src/components/Sidebar.tsx` — (только при подтверждённой проблеме) зависимость `notifyOn`.
- `test/core/skills/skills.test.ts` — тесты удаления; (опц.) тест Sidebar.
