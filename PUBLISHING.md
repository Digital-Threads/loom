# Loom — инструкция по выкатке (release / publishing)

Полная карта всех пакетов и плагинов экосистемы Loom: что это, где публикуется,
версионность и точные команды. Раздел «Что это и зачем» — человеческим языком,
для тех, кто будет этим пользоваться (можно брать как основу для README/описаний
в реестрах).

> Публикацию делает мейнтейнер (нужны логины npm / crates.io / права на GitHub).
> Код к публикации готов — см. порядок и команды ниже.

---

## 0. Три канала публикации

Loom собран из частей, которые живут в **трёх разных реестрах**:

| Канал | Что туда идёт | Чем ставится у пользователя |
|---|---|---|
| **npm** | ядро Loom (+ aimux как зависимость) + token-pilot(npm-обёртка) | `npm i -g @digital-threads/loom` |
| **crates.io** (cargo) | бинарники task-journal (Rust) | `cargo install task-journal-cli task-journal-mcp` |
| **Claude plugin marketplace** (GitHub-репозитории) | token-pilot и task-journal как плагины Claude Code | `claude plugin install <name>@<name>` |

Ядро `loom` тянет npm-зависимости автоматически. token-pilot и task-journal —
**не npm-зависимости ядра**: их доустанавливает онбординг Loom при первом запуске
(кнопка «Install missing»: cargo/claude-плагины). Bun — документированный
пререквизит (Loom запускается под bun).

---

## 1. Порядок выкатки (важно!)

Слои knowledge/swarm/quality/security теперь **внутри ядра** (`loom-host/src/core/layers/`),
отдельными npm-пакетами НЕ публикуются. Единственная sibling-зависимость ядра — aimux
(уже в реестре). Поэтому порядок упростился:

```
ШАГ 1 — ядро loom в npm (тянет aimux; 4 слоя уже внутри)
ШАГ 2 — task-journal в crates.io: task-journal-cli, task-journal-mcp
ШАГ 3 — Claude-плагины (token-pilot, task-journal): тег версии в их GitHub-репо
        (aimux и token-pilot(npm) уже опубликованы — их пропускаем)
```

---

## 2. Команды по каждому пакету

### npm-пакеты

> У ядра `loom` зависимость на aimux записана как `file:../aimux` для локальной
> разработки. Скрипт `scripts/prepare-publish.mjs` (хук `prepack`) **автоматически**
> подменяет любой `file:..` на версию из реестра в момент `npm publish` и возвращает
> обратно на `postpack`. Поэтому публиковать ядро нужно **только** через `npm publish`
> (НЕ `bun publish` и НЕ `bun i -g` из репо — там хуки не сработают и уедет битый
> `file:..`). Свап проверен end-to-end.

| Пакет | Папка | Версия | Команда публикации |
|---|---|---|---|
| `@digital-threads/loom` (ядро, слои внутри) | `loom-host/` | 0.1.0 | `cd loom-host && npm publish` (publishConfig уже `public`) |
| `@digital-threads/aimux` | `aimux/` | 0.13.0 | **уже в npm** — публиковать при изменениях |
| `token-pilot` (npm-часть) | `token-pilot/` | 0.46.1 | **уже в npm** |

Версионность: **semver в `package.json`** каждого пакета. Перед публикацией поднять
версию (`npm version patch|minor|major`), затем `npm publish`.

### crates.io (task-journal, Rust)

Каноничный исходник — `claude-memory/` (workspace, version 0.28.3). Публикуется
два бинарных крейта:

```bash
cd claude-memory
cargo publish -p task-journal-core      # сначала ядро-крейт (от него зависят остальные)
cargo publish -p task-journal-cli       # бинарь `task-journal`
cargo publish -p task-journal-mcp       # бинарь `task-journal-mcp`
```

Версионность: **в `Cargo.toml` (workspace `version`)**. Сейчас 0.28.3, в crates.io
**ещё не опубликованы**. Порядок: core → cli → mcp (cli/mcp зависят от core).

### Claude-плагины (marketplace = GitHub-репозиторий)

token-pilot и task-journal ставятся как плагины Claude Code из их GitHub-репо:

| Плагин | Marketplace (repo) | Команда у пользователя |
|---|---|---|
| token-pilot | `https://github.com/Digital-Threads/token-pilot` | `claude plugin marketplace add Digital-Threads/token-pilot` затем `claude plugin install token-pilot@token-pilot` |
| task-journal | `github:Digital-Threads/Task-Journal` | `claude plugin marketplace add Digital-Threads/Task-Journal` затем `claude plugin install task-journal@task-journal` |

Версионность плагина: **поле `version` в `plugin.json` + git-тег** вида
`<name>--v<version>`. Тег ставится командой `claude plugin tag` (она проверяет, что
`plugin.json` и запись в marketplace согласованы). Выкатка новой версии плагина =
бампнуть `version` в `plugin.json`, закоммитить, `claude plugin tag`, запушить тег.

> Эти команды Loom гоняет автоматически в онбординге (recipes
> `src/core/plugins/{token-pilot,task-journal}/plugin.json`) — пользователю
> руками их вводить не нужно.

---

## 3. После публикации — проверка чистой установки

```bash
# в чистом окружении (или временной папке)
npm i -g @digital-threads/loom        # должно подтянуть aimux + 4 слоя без битых file:..
loom                                   # стартует под bun, открывает UI
# в UI: онбординг → «Install missing» → доставит cargo/claude/task-journal/token-pilot
```

Если `npm i -g` ругается на нерезолвенные `@digital-threads/loom-*` — значит слои
ещё не в реестре (вернуться к ШАГУ 1).

---

## 4. Что это и зачем — человеческим языком

Описания для тех, кто будет пользоваться. Можно брать как тексты для README /
npm-описаний.

**Loom** (`@digital-threads/loom`) — оркестратор-конвейер для AI-разработки. Ты
ставишь задачу, а Loom проводит её по конвейеру (анализ → брейншторм → спека →
план → код → ревью → QA → PR), запуская на каждом шаге AI-агента в изолированной
песочнице и показывая всё на доске. Зачем: превращает «поболтать с ИИ» в
управляемый процесс с историей, стоимостью и автопилотом.

**aimux** (`@digital-threads/aimux`) — менеджер нескольких аккаунтов/подписок
Claude. Переключает профили, делит плагины и авторизацию между ними, ловит
лимиты. Зачем: работать без остановок, когда у одной подписки кончился лимит —
перекинуться на другую и продолжить ту же сессию.

**token-pilot** — экономный доступ к коду для агента. Вместо «прочитай весь файл /
grep по всему репо» даёт умные инструменты (читать символ, найти использования,
структурный diff) и экономит **60–80% токенов**. Зачем: те же задачи дешевле и
быстрее, без раздувания контекста.

**task-journal** — память рассуждений. Код показывает ЧТО изменилось — журнал
хранит ПОЧЕМУ: какие решения принял агент, что отверг и какие факты проверил, по
каждой задаче. Зачем: не терять контекст между сессиями и видеть историю «почему
так сделано».

**Внутренние слои ядра** (НЕ отдельные пакеты — живут в `loom-host/src/core/layers/`,
README рядом с кодом как внутренние доки):
- **knowledge** — recall прошлых решений/тупиков из журнала (граф, семантический поиск).
- **swarm** — мультиагентная координация: N попыток параллельно + консенсус.
- **quality** — ранеры ревью/QA (self/ralph/adversarial + проверки).
- **security** — песочница-worktree, allow/deny команд, скан секретов, аудит.

Это building-blocks, которые вызывает только Loom — самостоятельными продуктами не
являются, поэтому впихнуты внутрь ядра, а не публикуются отдельно.

---

## 5. Сводка статуса (на момент написания)

| Артефакт | Канал | Версия | Статус |
|---|---|---|---|
| @digital-threads/aimux | npm | 0.13.0 | ✅ опубликован |
| token-pilot (npm) | npm | 0.46.1 | ✅ опубликован |
| knowledge/swarm/quality/security | — | — | ✅ внутри ядра (не публикуются отдельно) |
| @digital-threads/loom (ядро) | npm | 0.1.0 | ⬜ публикуем (ШАГ 1) |
| task-journal-core/cli/mcp | crates.io | 0.28.3 | ⬜ публикуем (ШАГ 2) |
| token-pilot (Claude-плагин) | GitHub marketplace | — | репо есть, нужен тег версии |
| task-journal (Claude-плагин) | GitHub marketplace | — | репо есть, нужен тег версии |
