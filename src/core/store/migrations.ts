import type Database from "better-sqlite3";

// Forward-only schema migrations. Keyed by the TARGET version: MIGRATIONS[n]
// upgrades a db from version n-1 to n. CREATE_TABLES already uses
// `IF NOT EXISTS`, so brand-new tables need no migration — migrations are for
// column/shape changes to EXISTING data. Empty at v1 (baseline); the runner is
// here so future versions evolve user data without a manual step.
export type Migration = (db: Database.Database) => void;

export const MIGRATIONS: Record<number, Migration> = {
  // 2: (db) => db.exec("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0"),
};

/**
 * Apply every migration in (from, to] in order. Returns the version reached.
 * A missing migration for a version is a no-op (covered by IF NOT EXISTS DDL).
 * Injectable `migrations` for testing.
 */
export function runMigrations(
  db: Database.Database,
  from: number,
  to: number,
  migrations: Record<number, Migration> = MIGRATIONS,
): number {
  let reached = from;
  for (let target = from + 1; target <= to; target++) {
    migrations[target]?.(db);
    reached = target;
  }
  return reached;
}
