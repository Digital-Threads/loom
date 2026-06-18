# SDD — Очистка worktree/веток + гарантированная остановка живой сессии

- **Дата:** 2026-06-18
- **Пакет:** loom-host (один пакет, не монорепо)
- **Класс:** bug (две утечки ресурсов)
- **Журнал задачи:** tj-4neg5fzasw

---

## 1. Проблема (что чиним)

### Утечка №1 — worktree и ветки не удаляются
Каждая задача исполняется агентом в отдельном git-worktree с отдельной веткой
(`prepareWorktree`/`ensureWorktree` из пакета `@digital-threads/loom-security`).
Когда задача доходит до стадии `done`, код в `src/web/api.ts` (runner `done`,
L741–749) сохраняет историю (snapshot журнала + snapshot diff), закрывает задачу
и гасит сессию — но **никогда не удаляет ни worktree, ни ветку**.

Подтверждено: по всему `src` нет ни одного вызова `removeWorktree` или
`git worktree prune`. Комментарии в коде обещают «before worktree cleanup» и
«branch merged + deleted», но самой очистки нет. Итог: каталоги worktree и ветки
копятся за каждую завершённую задачу.

`removeWorktree(repoRoot, taskId)` из loom-security сносит **только** worktree
(`git worktree remove --force <path>`) — **ветку не трогает**. Поэтому очистка
ветки делается отдельно.

### Утечка №2 — `stop` не гарантирует убийство живого процесса
`stop(runId)` в `src/core/automation/run-manager.ts` (L121–128) только меняет
статус прогона на `failed` и снимает обработчик ввода. **Сам процесс Claude он не
убивает.** Убийство (`sessionLauncher.stop(sid)`) выполняет вызывающий код в
`api.ts` отдельной строкой рядом с `rm.stop(...)`. HTTP-эндпоинт `/stop`
(L979–981) делает оба, но как функция `stop(runId)` не даёт гарантии: любой
другой вызов `rm.stop(...)` без парного `sessionLauncher.stop` оставит процесс
Claude живым → продолжает идти биллинг.

---

## 2. Цель и критерии приёмки

1. После успешного `done` (строго **после** `snapshotJournal` + `snapshotDiff`)
   worktree задачи и её ветка удаляются.
2. `stop(runId)` **всегда** убивает живую сессию — без необходимости вызывающему
   коду отдельно звать `sessionLauncher.stop`.
3. Есть leak-guard: на старте хоста осиротевшие worktree/ветки (от done или
   удалённых задач) подчищаются, плюс `git worktree prune` снимает stale-записи
   о вручную удалённых каталогах.
4. Всё аддитивно, существующее поведение не ломается; `vitest run`, `tsc` (host) и
   `tsc`/build (web) — зелёные; `check:ds` зелёный (UI не трогаем).

---

## 3. Дизайн

### 3.1. Очистка worktree+ветки после `done`

**Новый host-хелпер** (в `src/web/api.ts`, рядом с `taskCwd`/`isGitRepo`):

```
cleanupTaskWorktree(repoRoot, taskId):
  // best-effort, ничего не должно валить завершение задачи
  removeWorktree(repoRoot, taskId)              // loom-security: git worktree remove --force
  git(["branch", "-D", worktreeBranch(taskId)], repoRoot)   // удалить ветку
  git(["worktree", "prune"], repoRoot)          // подчистить admin-записи
```

Импорты уже частично есть: `worktreeBranch`, `worktreePath`, `ensureWorktree`
(`api.ts` L58). Добавить импорт `removeWorktree` из
`../core/security/sandbox.js`.

**Вызов** — в runner `done` (L741–749), **после** строк snapshot:

```
done: async (_d, id) => {
  runDone(...);
  snapshotJournal(id);          // история рассуждений
  await snapshotDiff(id);       // diff заморожен
  recordTurn(...);
  const sid = getTaskSession(db, id).sessionId;
  if (sid) sessionLauncher.stop?.(sid);
  // NEW: после снапшотов — снести worktree + ветку
  const t = getTask(db, id);
  if (t?.repo && isGitRepo(t.repo)) cleanupTaskWorktree(t.repo, id);
  return { ok: true };
}
```

Почему безопасно удалять ветку: к моменту `done` diff заснапшочен
(`snapshotDiff`), а PR (если создавался) уже запушен на удалённый репозиторий —
локальная ветка больше не единственный носитель работы. `runDone`
(`core/pipeline/pr-done.ts` L130) сам мёрж не делает — только закрывает задачу;
мёрж PR происходит снаружи (GitHub). Поэтому «после done/мёржа» = после снапшотов.

### 3.2. Гарантированное убийство живой сессии в `stop`

**`createRunManager` получает опциональный хук** (аддитивно к текущему
`persist?`):

```
createRunManager(persist?, opts?: { stopLive?: (rec: RunRecord) => void })
```

В методе `stop(runId)` — звать хук **всегда** при переходе running→failed:

```
stop: (runId) => {
  const rec = runs.get(runId);
  if (!rec || rec.status !== "running") return false;
  rec.status = "failed";
  rec.error = "stopped by user";
  inputHandlers.delete(runId);
  try { opts?.stopLive?.(rec); } catch { /* best-effort */ }   // NEW: всегда убиваем процесс
  return true;
}
```

**Проводка в `api.ts`** (`createRunManager({...})`, L773–782) — передать
`stopLive`:

```
stopLive: (rec) => {
  if (!rec.taskId) return;
  const sid = getTaskSession(db, rec.taskId).sessionId;
  if (sid) sessionLauncher.stop?.(sid);
}
```

`sid` выводится из `taskId` через уже существующий `getTaskSession`
(`store/db.ts` L240) — отдельная карта runId→sid не нужна.

**Совместимость:** существующие парные вызовы (`/stop` L981, switch-profile L1005,
delete L966 и т.д.) остаются. `sessionLauncher.stop` и live `stop`
(`live-session.ts` L152) идемпотентны (no-op, если процесса нет), повторный вызов
безвреден.

### 3.3. Leak-guard для осиротевших worktree

**Новый host-хелпер** `sweepLeakedWorktrees(db)` — вызывается на старте, рядом с
`reconcileInterruptedRuns(db)` (`api.ts` L772):

```
sweepLeakedWorktrees(db):
  base = worktreesBaseDir()                       // securityDataDir()/worktrees
  если base нет — выход
  for taskId in subdirs(base):
    t = getTask(db, taskId)
    repo = t?.repo ?? repoFromWorktreeGitPointer(base/taskId)  // см. ниже
    нужно_снести = (t == null) || (t.status === "done")
    если нужно_снести и repo:
      removeWorktree(repo, taskId)
      git(["branch","-D", worktreeBranch(taskId)], repo)   // best-effort
  // подчистить stale admin-записи по всем известным repo
  for repo in distinct(t.repo для всех задач):
    git(["worktree","prune"], repo)
```

`repoFromWorktreeGitPointer` — читает файл `.git` внутри каталога worktree
(содержит `gitdir: <repo>/.git/worktrees/<taskId>`) и вычисляет корень основного
репозитория. Это даёт корректный `removeWorktree`/`prune` даже когда строки
задачи в БД уже нет. Если указатель не читается — пропускаем (best-effort).

`worktreesBaseDir()`/корень берём через `worktreePath(taskId)` из loom-security
(там `join(securityDataDir(), "worktrees", taskId)`), отрезая последний сегмент,
чтобы получить базовый каталог.

Активные задачи (running/waiting и т.п.) не трогаем — снос только для `done` и
полностью отсутствующих в БД.

---

## 4. Затрагиваемые файлы

| Файл | Изменение |
|------|-----------|
| `src/core/automation/run-manager.ts` | в `createRunManager` доб. опц. `opts.stopLive`; в `stop()` всегда звать его |
| `src/web/api.ts` | импорт `removeWorktree`; хелперы `cleanupTaskWorktree`, `sweepLeakedWorktrees`; вызов очистки в runner `done`; `stopLive` в `createRunManager({...})`; вызов `sweepLeakedWorktrees(db)` рядом с `reconcileInterruptedRuns` |

loom-security **не меняем** (scope-lock) — только переиспользуем
`removeWorktree`, `worktreeBranch`, `worktreePath`.

---

## 5. Тесты

`test/core/automation/run-manager.test.ts`:
- `stop(runId)` вызывает `stopLive(rec)` ровно один раз при переходе
  running→failed; для неизвестного/уже-settled прогона — не вызывает и возвращает
  `false`.
- хук, бросивший исключение, не ломает `stop` (best-effort).

`test/web/api.test.ts` (через инъекцию `git`-раннера / фейкового
`sessionLauncher`):
- после `done` вызывается удаление worktree и ветки (`git branch -D <branch>`)
  и **только после** snapshot.
- `/stop` по-прежнему убивает живой процесс (регрессия не сломана).
- leak-guard: для done/отсутствующей задачи worktree+ветка сносятся; активную
  задачу не трогает; вызывается `git worktree prune`.

Тесты только добавляем; существующие не ослабляем и не удаляем.

---

## 6. Риски и решения

- **Удаление ветки до мёржа PR** → теряем работу. Решение: чистим строго после
  `snapshotDiff` и при том, что PR уже запушен; в done это так.
- **Сбой git при очистке валит `done`** → всё в try/catch, best-effort, как
  существующий `removeWorktree`.
- **Орфан без строки задачи (repo неизвестен)** → берём repo из `.git`-указателя
  worktree; если не вышло — пропускаем, `git worktree prune` хотя бы снимет
  stale-запись.
- **DS/UI:** изменения чисто backend; `check:ds` и фронтенд не затрагиваем.
