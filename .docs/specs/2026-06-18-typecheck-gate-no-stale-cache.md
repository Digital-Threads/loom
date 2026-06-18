# SDD — Надёжный typecheck-гейт (не доверять стейл-кэшу tsc)

- **Дата:** 2026-06-18
- **Класс:** bug (fragility / надёжность гейта)
- **Scope:** только loom-host, self-contained
- **Task journal:** tj-5v0pgwmp9a

## 1. Проблема

Гейт проверки типов может дать **ложный «зелёный»**. Web-сборка использует
инкрементальный `tsc -b`, который доверяет файлу-кэшу `.tsbuildinfo`: если кэш
считает проект «не изменившимся», реальная перепроверка типов пропускается. На
практике из-за стейл-кэша были пропущены настоящие ошибки в `web` (`Tokens.tsx`:
`undefined usdHint` и отсутствующие импорты) — `build`/QA показали успех при
реально не компилирующемся коде.

Цель: сделать так, чтобы typecheck-гейт **никогда не доверял кэшу** и всегда
перепроверял типы заново.

## 2. Текущее состояние (факты из кода)

| Где | Скрипт | Кэш-доверие |
| --- | --- | --- |
| `web/package.json:9` | `build`: `... && tsc -b && vite build` | **ДА** — `tsc -b` читает `.tsbuildinfo` → ложный green |
| `web/package.json:11` | `typecheck`: `tsc --noEmit` | НЕТ — полная перепроверка (уже надёжен) |
| `web/tsconfig.json` | `noEmit: true`, не `composite` | режим `-b` для него не нужен |
| `package.json:21` | `build:host`: `tsc -p tsconfig.json` | НЕТ — в `tsconfig.json` нет `incremental`/`composite` → full-check |
| `tsconfig.tsbuildinfo` (корень) | закоммичен в git, **нет** в `.gitignore` | стейл-артефакт (мина): выстрелит, если включат `incremental` или `tsc -b` по корню |

Как это попадает в пайплайн: `src/core/quality/default-qa-checks.ts:82-84` —
QA-ключ `build` исполняет `<pm> run build` (root `package.json` build). Внутри
root build web собирается через `vite build web` **без** `tsc`, поэтому
web-typecheck в пайплайне приходит только из собственного `web/package.json`
`build` (`tsc -b`). Значит чинить надо именно его.

## 3. Решение

Минимальные, хирургические правки — менять только скрипты-гейты и стейл-артефакт.

### 3.1 Web (корень бага)
`web/package.json` → `build`: заменить `tsc -b` на `tsc --noEmit`.

```
"build": "node scripts/check-design-system.mjs && tsc --noEmit && vite build"
```

Обоснование: `web/tsconfig.json` уже `noEmit: true` и не `composite` — режим
`-b` избыточен; `tsc --noEmit` совпадает с уже надёжным скриптом `typecheck`,
всегда перепроверяет типы и не пишет `.tsbuildinfo`.

### 3.2 Host (host-гейт)
`package.json` `build:host`/`build` остаются `tsc -p tsconfig.json` — он уже
non-incremental (в `tsconfig.json` нет `incremental`/`composite`), то есть делает
полную проверку. Чтобы убрать host-аналог стейл-кэша:

- удалить закоммиченный `tsconfig.tsbuildinfo` из git;
- добавить `*.tsbuildinfo` в `.gitignore`, чтобы он не возвращался.

### 3.3 Защита от регресса (тест)
Добавить тест, который читает `package.json` (root) и `web/package.json` и
проверяет, что ни в одном build/typecheck-скрипте нет cache-trusting `tsc -b`
**без** `--force` (т.е. гейт не может снова начать доверять кэшу). Существующие
тесты QA-гейта (`default-qa-checks.test.ts`, `quality-l6.test.ts`) не трогать и
не ослаблять.

## 4. Рассмотренные альтернативы (отклонены)

- **web: `tsc -b --force`** — работает, но `-b` для не-`composite`/`noEmit`
  проекта избыточен; `--noEmit` проще и единообразен с `typecheck`.
- **web build вызывает `npm run typecheck`** — лишняя косвенность; прямой
  `tsc --noEmit` хирургичнее.
- **host: перейти на `tsc -b --force`** — `build:host` эмитит в `dist`; `tsc -p`
  уже даёт full-check, менять режим ради того же результата лишнее. Достаточно
  убрать стейл-артефакт.

## 5. Затрагиваемые файлы

- `web/package.json` — скрипт `build`.
- `package.json` (root) — проверить, host build уже надёжен (правок логики нет).
- `.gitignore` — добавить `*.tsbuildinfo`.
- `tsconfig.tsbuildinfo` — удалить из индекса git.
- новый тест (например `test/build-gate.test.ts`) — assert на скрипты.

## 6. Критерии приёмки

1. `web/package.json` `build` использует `tsc --noEmit` (или `tsc -b --force`),
   не голый `tsc -b`.
2. `tsconfig.tsbuildinfo` больше не отслеживается git; `*.tsbuildinfo` в `.gitignore`.
3. Новый тест падает на «голом `tsc -b`» и проходит после правки; старые тесты зелёные.
4. Зелёные: web `tsc --noEmit`, host `tsc -p tsconfig.json`, `check:ds`.
5. UI не менялся (english/DS без изменений); правки строго в пределах scope.

## 7. Вне scope

Рефактор сборки, изменение vite-конфигов, любые UI/CSS-правки, перенастройка
QA-флоу в `src/core/quality`. Реальные ошибки `Tokens.tsx` (`usdHint`/импорты) —
отдельная задача; здесь чиним только **надёжность гейта**, который их обязан ловить.
