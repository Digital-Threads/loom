# R&D-план (DAG) — Security.tsx: конфигурация политики безопасности

Цель: добавить в loom-host на вкладке **Security** просмотр/редактирование командной
политики (allow/deny), управление пользовательскими правилами секрет-скана,
индикатор «secret scanning: on/off» и сводку политики — на реальных данных
security-слоя. Только loom-host, self-contained, аддитивно к общему пакету
`@digital-threads/loom-security`, строго дизайн-система, web+host tsc зелёные, TDD.

## Проверенные на этом шаге факты (входят в план)

- `src/core/security/policy.ts` и `secrets.ts` — лишь реэкспорт пакета
  `@digital-threads/loom-security`. Реальные исходники пакета — вне worktree
  (симлинк). **Пакет не трогаем.**
- Командная политика (`CommandPolicy {allow?, deny?: RegExp[]}`, `DEFAULT_DENY` —
  6 паттернов, `checkCommand`) определена, но `find_usages(checkCommand)=0` —
  в рантайме хоста не подключена и пользовательского хранилища нет.
- Правила секретов — захардкоженный массив `PATTERNS` (7 видов) внутри `secrets.ts`.
- Секрет-скан всегда включён: `src/web/api.ts:371` безусловно зовёт `scanSecrets`;
  `secureExecutor` (пакет) принимает опцию `auditSecrets` (default true);
  вызов в `src/core/automation/start-run.ts:51` опций не передаёт, `db` есть на L41.
- Канал web↔host — Hono в `src/web/api.ts`. Есть `/api/settings` (GET `getAllSettings`,
  POST `setSetting`) и `/api/timeline`. Хранилище — `src/core/store/settings.ts`
  (`getSetting`/`setSetting`/`getAllSettings`, значения JSON-кодируются).
- Веб-клиент `web/src/api.ts`: `settings()`, `saveSetting()`, `timeline()` (L335–336).
- `check:ds` = `web/scripts/check-design-system.mjs`: запрет инлайн-цветов/шрифтов,
  `fontSize` только через `var(--fs-*)`.

## Архитектурное решение (зафиксировано)

Редактируемый слой держим **на стороне хоста** в settings-store (без изменений пакета):

- `security.policy.allow` — `string[]` (исходники regex), по умолчанию `[]`.
- `security.policy.deny` — `string[]` (доп. deny поверх `DEFAULT_DENY`), по умолчанию `[]`.
- `security.secrets.customRules` — `{ kind: string; source: string }[]`, по умолчанию `[]`.
- `security.secretScan.enabled` — `boolean`, по умолчанию `true`.

Дефолты (`DEFAULT_DENY`, `PATTERNS`) отдаём в API как **read-only** для показа.
Regex хранятся строками; компиляция и валидация — на сервере (чистый хелпер).

## Граф зависимостей

```
S1 (хелпер policy-config: типы, дефолты, валидация regex)
        │
        ▼
S2 (host API: /api/security/policy GET+POST, /api/security/secrets GET+POST, summary)
        │
        ├──────────────► S4 (гейт секрет-скана по настройке: api.ts:371 + start-run.ts)
        ▼
S3 (web-клиент: методы securityConfig/save...)
        │
        ▼
S5 (UI Security.tsx: блоки allow/deny, правила секретов, индикатор+сводка)
        │
        ▼
S6 (верификация: check:ds, web+host tsc, тесты)
```

S1→S2→S3→S5 — линейная цепочка. S4 зависит только от S1/S2 и может идти параллельно S3.

---

## S1 — Хелпер конфигурации политики (ядро, чистый, тестируемый)

**Что реализуется.** Новый модуль на стороне хоста (например
`src/core/security/policy-config.ts`), который:
- объявляет shape настроек (`SecurityConfig`: allow/deny строки, customRules, enabled);
- отдаёт дефолтные паттерны для показа: `defaultDenySources(): string[]` (из `DEFAULT_DENY`
  через `.source`) и `defaultSecretRules(): {kind,source}[]` — берём из пакета
  публично; если `PATTERNS` не экспортируется, добавляем **аддитивный** экспорт в
  пакете (отдельной строкой `export`, ничего не меняя в существующем) — решение
  на impl, по факту экспортируемости;
- валидирует/компилирует пользовательские regex: `compileRegex(src): {ok, error?}`,
  отбрасывая битые паттерны без падения;
- собирает «эффективную» политику: `effectivePolicy(cfg): CommandPolicy` (deny =
  DEFAULT_DENY + валидные user-deny; allow = валидные user-allow);
- считает сводку: `policySummary(cfg)` → счётчики allow/deny/секрет-правил + `enabled`.

**Файлы.** `src/core/security/policy-config.ts` (новый);
возможно аддитивный `export` в пакете `secrets.ts`/`policy.ts` (только если нужно).

**Критерий готовности.** Юнит-тесты (vitest) зелёные: битый regex не валит
`compileRegex`; `effectivePolicy` всегда включает `DEFAULT_DENY`; `policySummary`
возвращает верные счётчики и `enabled`. `tsc` по хосту проходит.

---

## S2 — Host API: чтение/запись политики и правил, сводка

**Что реализуется.** Новые эндпоинты в `src/web/api.ts` (рядом с `/api/settings`):
- `GET /api/security/policy` → `{ defaults: {deny:string[]}, allow:string[], deny:string[], summary }`.
- `POST /api/security/policy` → принимает `{ allow?:string[], deny?:string[] }`,
  валидирует каждый regex (400 при битом), сохраняет через `setSetting`.
- `GET /api/security/secrets` → `{ defaults:{kind,source}[], custom:{kind,source}[], enabled:boolean }`.
- `POST /api/security/secrets` → `{ custom?:{kind,source}[], enabled?:boolean }`,
  валидирует regex правил, сохраняет.

Все используют `getSetting`/`setSetting` (S1-хелпер для дефолтов/валидации).

**Файлы.** `src/web/api.ts` (только добавление маршрутов).

**Критерий готовности.** Тест(ы) на хэндлеры (через существующий тест-харнесс api,
если есть; иначе на хелпер уровня S1 + ручной smoke): GET отдаёт дефолты+сохранённое,
POST с битым regex → 400, POST с валидным → 200 и значение читается обратно.
`tsc` хоста зелёный.

---

## S3 — Веб-клиент: методы доступа к политике

**Что реализуется.** В `web/src/api.ts` добавить методы рядом с `settings()`:
`securityPolicy()`, `saveSecurityPolicy(allow,deny)`, `securitySecrets()`,
`saveSecuritySecrets(custom, enabled)` — обёртки над `getJson`/`postJson`,
с типами ответов (новые `interface` в клиентских типах).

**Файлы.** `web/src/api.ts` (+ типы в нём же или соседнем types-файле).

**Критерий готовности.** `tsc` web зелёный; методы типобезопасно соответствуют
ответам S2.

---

## S4 — Реальный гейт секрет-скана по настройке

**Что реализуется.** Сделать индикатор on/off не косметикой, а реальным управлением:
- `src/web/api.ts:371` — перед `scanSecrets(text)` читать
  `getSetting(db, "security.secretScan.enabled", true)`; при `false` — пропускать скан/аудит.
- `src/core/automation/start-run.ts:51` — передать
  `secureExecutor(createAimuxExecutor(), { auditSecrets: getSetting(db, "security.secretScan.enabled", true) })`.

Изменение аддитивное: пакет уже поддерживает `auditSecrets`; меняется только
вызов на стороне хоста.

**Файлы.** `src/web/api.ts`, `src/core/automation/start-run.ts`.

**Критерий готовности.** При `enabled=false` секрет-аудит не пишется (проверяемо
юнит/интеграционно на хост-функции); дефолт `true` сохраняет текущее поведение —
существующие тесты не падают.

---

## S5 — UI: блоки конфигурации в Security.tsx

**Что реализуется.** В `web/src/components/Security.tsx` поверх текущих
sandbox-тоггла и аудита добавить:
1. **Индикатор + сводка** — «secret scanning: on/off» (кнопка/бейдж, как у OS sandbox)
   и краткая сводка политики (N allow / M deny / K правил секретов).
2. **Командная политика** — два редактируемых списка allow/deny (показ дефолтного
   `DEFAULT_DENY` как read-only + добавление/удаление пользовательских паттернов),
   inline-валидация битого regex.
3. **Правила секрет-скана** — список дефолтных видов (read-only) + добавление/удаление
   пользовательских `{kind, source}`.

Данные грузятся через S3-клиент; сохранение — соответствующими методами.
UI — english. Строго дизайн-система: только существующие классы (`panel`, `kv`,
`btn`, `finding-list`, `stat`…), без инлайн-цветов/шрифтов, `fontSize` только
`var(--fs-*)`. Состояния loading/error/empty — через `StateView`.

**Файлы.** `web/src/components/Security.tsx`; при необходимости новые классы —
в общий web-стиль-файл, но в рамках DS.

**Критерий готовности.** `npm run check:ds` зелёный; вкладка отображает реальные
дефолты+сохранённые правила; добавление/удаление/тоггл сохраняются и переживают
перезагрузку; `tsc` web зелёный.

---

## S6 — Верификация и зачистка

**Что реализуется.** Прогон полного набора: `npm run check:ds`, `tsc` (web и host),
весь тест-сьют (`test_summary`), визуальный smoke вкладки Security.

**Файлы.** —

**Критерий готовности.** check:ds зелёный; оба tsc зелёные; тесты не сломаны
(новые проходят); индикатор и редакторы работают на реальных данных.

## Открытые вопросы к impl (из рисков)

1. Экспортируется ли `PATTERNS` из пакета? Если нет — добавить **аддитивный** экспорт
   (одна строка, без изменения логики) либо продублировать read-only-список видов на
   хосте. Решить по факту в S1.
2. Глубина гейта on/off: гейтим оба пути секрет-скана (session + run). Подтверждено
   планом (S4); командная политика (allow/deny) пока остаётся конфигурируемой и
   видимой, без насильного подключения `checkCommand` в рантайм (это вне объёма —
   фиксируем как наблюдение, не реализуем без отдельного запроса).
3. Есть ли тест-харнесс для Hono-эндпоинтов? Если нет — основное покрытие на уровне
   чистого хелпера S1, эндпоинты — smoke.
