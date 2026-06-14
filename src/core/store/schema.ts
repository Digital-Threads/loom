// Core-store schema. Loom owns this store — plan/DAG/run-state/cost lives here.
// task-journal = memory "why"; this = operational state "what/where/how much".

export const SCHEMA_VERSION = 1;

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'created',
    run_mode    TEXT NOT NULL DEFAULT 'gated',
    route       TEXT,          -- JSON array of stage keys (the adaptive route)
    repo        TEXT,
    branch      TEXT,
    description TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stages (
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    stage_key   TEXT NOT NULL,          -- analysis | brainstorm | spec | rd | impl | review | qa | pr | done
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | active | done | skipped
    gate        INTEGER NOT NULL DEFAULT 1,       -- 1 = gate enabled, 0 = auto-pass
    started_at  INTEGER,
    finished_at INTEGER,
    PRIMARY KEY (task_id, stage_key)
  );

  CREATE TABLE IF NOT EXISTS steps (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    title       TEXT NOT NULL,
    approach    TEXT,
    files       TEXT,          -- JSON array of paths
    agent       TEXT,          -- skill / agent type
    model       TEXT,
    profile     TEXT,          -- aimux profile
    depends_on  TEXT,          -- JSON array of step ids
    status      TEXT NOT NULL DEFAULT 'pending',
    exit_code   INTEGER,
    started_at  INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    step_id     TEXT REFERENCES steps(id),
    workflow_id TEXT,
    session_id  TEXT,
    profile     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    exit_code   INTEGER,
    stdout      TEXT,
    stderr      TEXT,
    started_at  INTEGER,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS cost_rollups (
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    source      TEXT NOT NULL,          -- 'aimux' | 'token-pilot'
    metric      TEXT NOT NULL,          -- 'spent' | 'saved'
    value       REAL NOT NULL DEFAULT 0,
    exact       INTEGER NOT NULL DEFAULT 0,   -- 1 = spine-linked, 0 = estimate
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (task_id, source, metric)
  );

  -- L12 — artifacts flow stage→stage (brainstorm-summary, spec-md, plan-dag, pr-description)
  CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    stage       TEXT NOT NULL,
    kind        TEXT NOT NULL,          -- brainstorm-summary | spec-md | plan-dag | pr-description
    content     TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'draft',  -- draft | accepted | returned
    created_at  INTEGER NOT NULL
  );

  -- L12 — brainstorm chat transcript (one row per message; resume by replay)
  CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    stage       TEXT NOT NULL,
    role        TEXT NOT NULL,          -- user | agent
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
`;
