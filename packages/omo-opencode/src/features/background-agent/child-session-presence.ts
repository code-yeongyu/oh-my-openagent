import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDataDir } from "../../shared/data-path"
import { log } from "../../shared/logger"
import type { ChildPresence } from "./task-recovery-sweep"

export interface ChildSessionPresence {
  readonly lookup: (sessionId: string) => ChildPresence
  readonly close: () => void
}

async function importBunSqlite(): Promise<typeof import("bun:sqlite") | undefined> {
  if (typeof globalThis.Bun === "undefined") return undefined
  // new Function() keeps a Node/Electron ESM parser from resolving the bun: specifier.
  const dynamicImport = new Function("return import('bun:sqlite')") as () => Promise<typeof import("bun:sqlite")>
  return dynamicImport()
}

/*
 * Reads opencode's session table directly. Asking the server instead routes
 * `session.get` to the child's own directory, which boots an opencode
 * instance, plugins included, for every directory the sweep touches. Without
 * a readable database every child counts as unknown, so nothing is removed.
 */
export async function openChildSessionPresence(dbPath = join(getDataDir(), "opencode", "opencode.db")): Promise<ChildSessionPresence | undefined> {
  if (!existsSync(dbPath)) return undefined
  try {
    const sqlite = await importBunSqlite()
    if (!sqlite) return undefined
    const db = new sqlite.Database(dbPath, { readonly: true })
    const query = db.prepare("SELECT 1 AS found FROM session WHERE id = ?")
    return {
      lookup: (sessionId) => {
        try {
          return query.get(sessionId) ? "exists" : "missing"
        } catch (error) {
          if (!(error instanceof Error)) throw error
          return "unknown"
        }
      },
      close: () => db.close(),
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    log("[background-agent] Session database unavailable for the task recovery sweep:", { error: error.message })
    return undefined
  }
}
