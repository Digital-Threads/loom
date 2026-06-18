# SDD — C1: гарантировать включение token-pilot во всех сессиях loom-host

Дата: 2026-06-18 · Класс: feature · Скоуп: только `loom-host`, self-contained.

## 1. Проблема

Платформа Loom насильно включает обязательные инструменты (token-pilot) в каждую
сессию агента через файл настроек, передаваемый как `--settings`
(`enforced-settings.ts` → `aimux-session-launcher.ts:43`). Сегодня это покрыто
только частично, и есть три дыры + одна проглоченная ошибка:

- **(а)** `createAimuxStageAgent` (`src/core/pipeline/stage-agent.ts:23`) запускает
  `runProfileHeadless` с `extraArgs: ["-p", prompt]` **без** `ENFORCE_FLAGS` —
  значит, диалоговые стадии и генерация скилла (`src/web/api.ts:1781`,
  `/api/skills/generate`) бегут БЕЗ token-pilot.
- **(б)** Если `token-pilot` нет в `PATH`, сессия тихо работает без него: хуки
  падают, агент откатывается на сырое чтение. Никакого видимого сигнала.
- **(в)** Нет проверки, что token-pilot реально сработал в сессии.
- **(г)** Ошибка записи файла настроек в `enforcedSettingsPath()`
  (`src/core/automation/enforced-settings.ts:80`) проглатывается пустым `catch`.

## 2. Цель и критерии приёмки

| # | Что | Критерий «готово» |
|---|-----|-------------------|
| 1 | Preflight: `token-pilot` на PATH | При отсутствии — видимый маркер (doctor-отчёт + лог при старте), НЕ тихая деградация |
| 2 | Post-session assertion | После рана: нет ни одного hook-event в `.token-pilot/hook-events*.jsonl` → ран помечен `token-pilot did not engage` |
| 3 | `ENFORCE_FLAGS` в stage-agent | `createAimuxStageAgent` передаёт `--settings <enforcedSettingsPath>`; skill-path покрыт автоматически (тот же код) |
| 4 | Ошибка записи настроек видима | Сбой записи в `enforcedSettingsPath()` логируется заметно, не проглатывается |

Сквозные: строго DS (`bun run check:ds`, размеры шрифта только через `var(--fs-*)`),
текст UI на английском, тесты на каждый пункт, `tsc --noEmit` зелёный для web и host
(через `tsc -b --force` / `--noEmit`, без доверия инкрементальному кэшу).

## 3. Дизайн

### 3.1. Единый источник флагов (пункт 3)

Сейчас `ENFORCE_FLAGS` определён локально в `aimux-session-launcher.ts:43`:
```ts
const ENFORCE_FLAGS = ["--settings", enforcedSettingsPath()];
```

**Решение:** вынести в `enforced-settings.ts` экспортируемый хелпер — один
источник правды, чтобы пути не разъезжались:
```ts
/** The launch flags that force token-pilot's hooks into a session. */
export function enforceFlags(): string[] {
  return ["--settings", enforcedSettingsPath()];
}
```

- `stage-agent.ts` — добавить флаги в `extraArgs`:
  ```ts
  const res = await launch(cfg, profile, { model: deps.model, extraArgs: ["-p", prompt, ...enforceFlags()] });
  ```
- `aimux-session-launcher.ts` — заменить локальный `const ENFORCE_FLAGS` на вызов
  `enforceFlags()` (поведение идентично — тот же массив, тот же путь; чисто
  убирает дублирование).

**Skill-path:** `/api/skills/generate` (`api.ts:1781`) использует
`createAimuxStageAgent({ profile })` — отдельной правки не требует, покрывается
правкой `stage-agent.ts`.

Альтернатива (отклонена): дублировать массив в stage-agent — приведёт к дрейфу
путей при будущих изменениях.

### 3.2. Не глотать ошибку записи (пункт 4)

`enforced-settings.ts:80`, текущий блок:
```ts
} catch {
  cachedPath = path; // best-effort; a stale/partial file still beats none
}
```
**Решение:** сделать сбой видимым и НЕ кэшировать путь при ошибке (чтобы
следующий вызов попробовал записать снова):
```ts
} catch (err) {
  // Visible, not swallowed: a missing settings file means the session would run
  // WITHOUT token-pilot enforcement — that must never be silent.
  console.error(`[loom] failed to write enforced-settings to ${path}:`, err);
  // do NOT cache on failure — let a later call retry the write.
  return path; // best-effort: still hand back the path for this call
}
```
Альтернатива (отклонена): `throw` — `enforcedSettingsPath()` вызывается при
вычислении флагов на импорте модуля лаунчера; исключение уронит запуск лаунчера.
Поэтому видимый лог, а не throw.

### 3.3. Preflight `token-pilot` на PATH (пункт 1)

Две дополняющие, чисто аддитивные меры:

1. **В doctor/onboarding (видимый «баннер»):** добавить `token-pilot` в
   `REQUIRED_TOOLS` (`src/core/doctor/prereqs.ts`):
   ```ts
   { name: "token-pilot", hint: "token-pilot required for enforced token-efficient reads: npm i -g token-pilot" },
   ```
   `checkPrerequisites()` уже пробует `which token-pilot`; запись попадёт в
   `/api/doctor` и существующий онбординг-UI покажет её как недостающую — это и
   есть видимый маркер, **без нового UI-компонента и без новых `font-size`**
   (риск `check:ds` минимален).

2. **Маркер при старте (headless):** одноразовая проверка при инициализации
   лаунчера. Добавить в `enforced-settings.ts` (рядом с настройками) лёгкий
   хелпер на том же зонде `which`, что и doctor, и звать его один раз из
   `createAimuxLiveLauncher`:
   ```ts
   export function tokenPilotOnPath(run = defaultRun, platform = process.platform): boolean {
     return run(resolveProbeCmd("which", platform), ["token-pilot"]).ok;
   }
   ```
   ```ts
   // in createAimuxLiveLauncher (once): warn loudly, do not silently degrade.
   if (!tokenPilotOnPath()) console.warn("[loom] token-pilot is NOT on PATH — sessions will run WITHOUT enforced token-efficient tools");
   ```

Альтернатива (отклонена): отдельный UI-баннер с собственной типографикой —
лишний код и риск `check:ds`; существующий doctor уже даёт видимость.

### 3.4. Post-session assertion (пункт 2)

`src/core/plugins/token-pilot/adapter.ts` уже умеет находить и читать
`.token-pilot/hook-events*.jsonl` (`collectHookEventFiles`, `readHookEvents`).

1. **Новый экспорт в adapter.ts** (аддитивно):
   ```ts
   /** True if token-pilot left at least one hook-event for this worktree —
    *  i.e. its enforcement hooks actually fired during the session. */
   export function tokenPilotEngaged(projectRoot: string): boolean {
     return readHookEvents(projectRoot).length > 0;
   }
   ```

2. **Вызов в `start-run.ts`** (внутри `rm.start` callback, после `runSpec` и
   `recordRunCost`): корень рабочей копии берём так же, как для cost —
   `opts.sandbox?.repoRoot ?? resolveProjectRoot(process.cwd())`. Если не сработал
   — пометить ран видимым предупреждением через шину событий (best-effort):
   ```ts
   const root = opts.sandbox?.repoRoot ?? resolveProjectRoot(process.cwd());
   if (!tokenPilotEngaged(root)) {
     ctx.emit(makeEvent({
       ts: Date.now(), source: "loom", projectId: ids.projectId, taskId: ids.taskId,
       type: "preflight", severity: "warn", message: "token-pilot did not engage",
     }));
   }
   ```
   Событие стримится в run-record / SSE / борд — это и есть «пометка рана».

**Best-effort:** ошибка проверки или эмита НЕ должна валить ран (обернуть в
`try/catch`). Сам ран не переводим в `failed` — задача просила «пометить», а не
ронять (тихая деградация недопустима, жёсткий fail не требовался).

Тайминг: `runSpec` уже `await`-нут к моменту проверки, сессии завершены и хуки
успели дописать файлы. Принимаем как best-effort (возможная задержка флаша файла
не критична для маркера).

## 4. Затрагиваемые файлы

| Файл | Изменение |
|------|-----------|
| `src/core/automation/enforced-settings.ts` | `export enforceFlags()`, `export tokenPilotOnPath()`, видимый лог в `catch` (стр. 80) |
| `src/core/pipeline/stage-agent.ts` | `...enforceFlags()` в `extraArgs` |
| `src/core/automation/aimux-session-launcher.ts` | `ENFORCE_FLAGS` → `enforceFlags()`; одноразовый `tokenPilotOnPath()`-warn |
| `src/core/doctor/prereqs.ts` | `token-pilot` в `REQUIRED_TOOLS` |
| `src/core/plugins/token-pilot/adapter.ts` | `export tokenPilotEngaged(projectRoot)` |
| `src/core/automation/start-run.ts` | assertion-вызов + warning-событие |

Все изменения аддитивные; живой путь лаунчера поведенчески не меняется.

## 5. Тесты

1. **stage-agent** — мок `launch`, проверить, что `extraArgs` содержит
   `--settings` и путь `enforcedSettingsPath()` (и `-p prompt`).
2. **enforceFlags** — возвращает `["--settings", <path>]`; путь == `enforcedSettingsPath()`.
3. **enforced-settings write fail** — замокать `writeFileSync`, чтобы кидал;
   проверить, что вызван `console.error` (spy) и `cachedPath` не закэширован
   (повторный вызов снова пытается писать).
4. **prereqs** — `token-pilot` присутствует в `REQUIRED_TOOLS`; при `which`,
   возвращающем not-found, попадает в `missing`.
5. **tokenPilotOnPath** — true/false по результату инъецированного `run`.
6. **tokenPilotEngaged** — на временном каталоге: пусто → false; с одним
   `.token-pilot/hook-events.jsonl` → true.
7. **start-run assertion** — при пустых hook-events эмитится событие
   `severity:"warn"`, `message:"token-pilot did not engage"`; при наличии —
   событие не эмитится; ошибка проверки не валит ран.

Существующий тест на `ENFORCED_SETTINGS` (чистый token-pilot конфиг) сохраняем —
правки его не касаются.

## 6. Риски / открытые вопросы

- **DS:** новый UI-текст не добавляется (используем существующий doctor-список),
  поэтому `check:ds` должен оставаться зелёным; всё равно прогнать.
- **Тайминг hook-events** — best-effort, как описано в 3.4.
- **`console.warn`/`console.error`** — соответствует уже принятому в кодовой базе
  стилю логирования (best-effort блоки рядом); UI-строки английские.

## 7. Проверка перед завершением

- `bun run check:ds` — зелёно.
- `tsc -p tsconfig.json --noEmit` (host) и web-tsc — зелёно (через `-b --force` /
  `--noEmit`, без инкрементального кэша).
- Все тесты из §5 + существующий набор — зелёно.
