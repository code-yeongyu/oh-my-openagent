import type { Database } from "bun:sqlite"
import { PROBE_LAB_MIGRATIONS } from "./schema"

export function applyProbeLabMigrations(db: Database): void {
  for (const stmt of PROBE_LAB_MIGRATIONS) {
    try {
      db.run(stmt)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("duplicate column name")) continue
      throw err
    }
  }
}
