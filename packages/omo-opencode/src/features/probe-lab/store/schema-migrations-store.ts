import type { Database } from "bun:sqlite"

export type SchemaMigrationRow = {
  version: number
  applied_at: number
  description: string | null
}

export type SchemaMigrationsStore = ReturnType<typeof createSchemaMigrationsStore>

export function createSchemaMigrationsStore(db: Database) {
  function recordMigration(version: number, description?: string | null): SchemaMigrationRow {
    db.run(
      `INSERT INTO schema_migrations (version, description)
       VALUES (?1, ?2)
       ON CONFLICT(version) DO UPDATE SET description = excluded.description`,
      [version, description ?? null],
    )
    return db.query<SchemaMigrationRow, [number]>(
      "SELECT * FROM schema_migrations WHERE version = ?1",
    ).get(version)!
  }

  function listApplied(): SchemaMigrationRow[] {
    return db.query<SchemaMigrationRow, []>(
      "SELECT * FROM schema_migrations ORDER BY version DESC",
    ).all()
  }

  function isApplied(version: number): boolean {
    const row = db.query<{ version: number }, [number]>(
      "SELECT version FROM schema_migrations WHERE version = ?1",
    ).get(version)
    return row != null
  }

  return { recordMigration, listApplied, isApplied }
}
