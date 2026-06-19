# P0 — aimux live-session API + чистая граница aimux↔Loom

**Эпик:** loom-iif8 · **Задача:** loom-qnla · **Журнал:** tj-qcshh6jjvw
**Дата:** 2026-06-19

## Цель

Перенести единственную прямую связь Loom↔claude (драйв `-p` stream-json сессии)
**внутрь aimux**, чтобы Loom не знал про claude/`-p`/флаги вообще. Делается через
**добавление функционала в aimux** (PR), не ломая его — строго по смыслу aimux.

## Что такое aimux (из README) — почему live-session по смыслу его

aimux = «оркестратор мульти-подписок»: `aimux run <profile>` запускает claude под
`CLAUDE_CONFIG_DIR`+model, флаги пробрасываются; уже есть `runProfileHeadless`
(одноразовый запуск), `aimux agents` (фоновые claude-сессии по всем профилям),
fallback-model, per-profile env, API-профили (3rd-party эндпоинты). **Персистентная
многоходовая сессия под профилем — естественный сиблинг `runProfileHeadless`.**

## Решающие факты (зафиксированы, sourced)

- Подписки (Pro/Max) работают **только** через CLI + `CLAUDE_CONFIG_DIR`. SDK =
  только API-ключи; subscription-auth для third-party **запрещён Anthropic**
  (June 2026). ⇒ остаёмся на CLI — это и есть домен aimux.
- Модель **нельзя** сменить mid-session ни в одном поддерживаемом режиме (`/model`
  в headless отключён; SDK/PTY не решают). ⇒ per-stage модель = **сессия на
  модель-группу**.

## Граница (принцип: в aimux — только то, что его по смыслу)

### aimux получает (PR) — generic, переиспользуемо

Новый модуль `liveSession` рядом с `run.ts`:

```ts
// aimux/src/core/liveSession.ts
export interface OpenSessionOptions {
  model?: string;            // tier/model для ЭТОЙ сессии (aimux уже умеет -m)
  sessionId?: string;        // --session-id (создать) ...
  resume?: boolean;          // ... или --resume
  cwd?: string;
  env?: Record<string,string>;     // доп. env (поверх per-profile env)
  settingsPath?: string;     // → --settings (значение даёт consumer)
  mcpConfigPath?: string;    // → --mcp-config
  allowedTools?: string[];   // → --allowedTools=csv
  bypassPermissions?: boolean; // → --dangerously-skip-permissions
}
export interface SessionEvent { /* типизированный разбор stream-json */ }
export interface LiveSession {
  send(text: string): AsyncIterable<SessionEvent>;  // ход → поток событий
  resume(): void;
  relocate(toProfile: string): Promise<void>;       // смена аккаунта (домен aimux)
  close(): void;
}
export function openSession(cfg, profile: string, opts?: OpenSessionOptions): LiveSession;
```

**aimux владеет:** `CLAUDE_CONFIG_DIR`/model/fallback/per-profile env, **протокол
`-p --input-format stream-json`** (spawn + парсинг событий + resume), **relocate**
(копирование сессии в config-dir другого профиля — это ядро мульти-подписок aimux).

### Loom держит (Loom-специфика — НЕ в aimux)

- Выбор **профиля на задачу** и **модели на стадию** (policy) — передаёт в `opts`.
- **Контент**: token-pilot enforce-settings файл (`settingsPath`), путь Loom-MCP
  реестра (`mcpConfigPath`), spine env `LOOM_TASK_ID` (`opts.env`).
- **degraded-маркеры → атрибуция ЗАДАЧЕ**, пайплайн, промпты, перезапуск стадий.

Loom передаёт **значения/intent**, не синтаксис claude-флагов. Имена флагов
(`-p`, `--settings`, `--mcp-config`, `--dangerously-skip-permissions`) знает
**только aimux**.

## Что переносится из Loom

Из `loom-host/src/core/automation/`:
- `aimux-session-launcher.ts` — `STREAM_FLAGS`, spawn, stream-json драйв → **в aimux**.
- `live-session.ts` — многоходовой протокол (ensure/send/interject/resume) → **в aimux**.
- Остаётся в Loom: тонкая обёртка `AgentRuntime.launcher`, которая зовёт
  `aimux.openSession(...)` и прокидывает Loom-значения (settings/mcp/env/perms);
  degraded-атрибуция; enforce-settings писатель (контент token-pilot).

## План реализации (TDD, PR в aimux)

1. **aimux PR**: `liveSession.ts` + типы + тесты (мок spawn, проверка флагов из
   профиля+opts, парсинг stream-json событий, resume, relocate). Экспорт из
   `core/index.ts`. Версия-бамп, publish — отдельно.
2. **Loom P1 (loom-tnqz)**: `AgentRuntime.launcher` → обёртка над `aimux.openSession`;
   удалить `STREAM_FLAGS`/stream-json из Loom; переписать тесты launcher на мок
   aimux-API; degraded-маркеры остаются в Loom.
3. Поверх: per-stage модели (loom-0r7h) = `openSession({model: tier})` на группу;
   ручной выбор (loom-skkj); профили/ротация (loom-2bn5).

## Открытые вопросы (на апрув)

1. Границу `allowedTools`/`bypassPermissions`/`mcpConfigPath` как **first-class opts**
   aimux (aimux владеет синтаксисом флага) — ок? Или это Loom-policy и держать
   через generic `extraArgs`? (Рекомендую first-class — тогда Loom не знает флагов.)
2. `relocate` (смена аккаунта mid-session) переносим в aimux в P0 или оставляем
   пока в Loom и доращиваем aimux позже? (Рекомендую в aimux — это его ядро.)
3. Объём первого aimux-PR: минимальный live-session (spawn+stream+resume) сначала,
   relocate/enforce — вторым PR? Или всё разом?
