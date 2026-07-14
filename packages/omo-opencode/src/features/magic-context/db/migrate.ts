/**
 * Idempotent schema migration runner.
 *
 * On first open: creates the `schema_migrations` tracking table,
 * then applies all DDL from `schema.ts` in one pass, recording
 * `SCHEMA_VERSION` as applied.
 *
 * On subsequent opens: detects that version 1 is already recorded
 * and skips — the DDL is all `IF NOT EXISTS` so re-running it is
 * safe, but we avoid the exec overhead since every table/index
 * already exists.
 */

import type { Database } from "./sqlite"
import { SCHEMA_VERSION, SCHEMA_DDL } from "./schema"

export function runMigrations(db: Database): void {
  // Ensure the migrations tracking table exists first
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      applied_at INTEGER NOT NULL
    );
  `)

  // Check already-applied versions
  const applied = new Set<number>()
  const rows = db
    .prepare(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    )
    .all() as { version: number }[]

  for (const row of rows) {
    applied.add(row.version)
  }

  if (applied.has(SCHEMA_VERSION)) {
    return // Already at latest schema — nothing to do
  }

  // Apply all DDL in a single transaction
  db.transaction(() => {
    db.exec(SCHEMA_DDL)

    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
    ).run(
      SCHEMA_VERSION,
      `Initial MaTrix port — all core MC tables`,
      Date.now(),
    )
  })()
}
