import { join } from "node:path"
import { existsSync } from "node:fs"
import { getDataDir } from "../shared/data-path"
import { log } from "../shared"

type BunDatabase = import("bun:sqlite").Database

/**
 * Safely import bun:sqlite only when running in Bun runtime.
 * Uses new Function() to hide the import from Node.js/Electron's static parser,
 * which would fail on bun: protocol resolution before .catch() could run.
 */
async function importBunSqlite(): Promise<typeof import("bun:sqlite") | null> {
  if (typeof globalThis.Bun === "undefined") {
    return null
  }
  try {
    // new Function() prevents Node.js ESM loader from seeing the bun: import at parse time
    const dynamicImport = new Function("return import('bun:sqlite')") as () => Promise<typeof import("bun:sqlite")>
    return await dynamicImport()
  } catch {
    return null
  }
}

function getDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

const MAX_MICROTASK_RETRIES = 10

function tryUpdateMessageModel(
  db: BunDatabase,
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant?: string,
): boolean {
  const stmt = db.prepare(
    `UPDATE message SET data = json_set(data, '$.model.providerID', ?, '$.model.modelID', ?) WHERE id = ?`,
  )
  const result = stmt.run(targetModel.providerID, targetModel.modelID, messageId)
  if (result.changes === 0) return false
  if (variant) {
    db.prepare(
      `UPDATE message SET data = json_set(data, '$.variant', ?, '$.thinking', ?) WHERE id = ?`,
    ).run(variant, variant, messageId)
  }
  return true
}

function retryViaMicrotask(
  db: BunDatabase,
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant: string | undefined,
  attempt: number,
): void {
  if (attempt >= MAX_MICROTASK_RETRIES) {
    log("[ultrawork-db-override] Exhausted microtask retries, falling back to setTimeout", {
      messageId,
      attempt,
    })
    setTimeout(() => {
      try {
        if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
          log(`[ultrawork-db-override] setTimeout fallback succeeded: ${targetModel.providerID}/${targetModel.modelID}`, { messageId })
        } else {
          log("[ultrawork-db-override] setTimeout fallback failed - message not found", { messageId })
        }
      } catch (error) {
        log("[ultrawork-db-override] setTimeout fallback failed with error", {
          messageId,
          error: String(error),
        })
      } finally {
        try {
          db.close()
        } catch (error) {
          log("[ultrawork-db-override] Failed to close DB after setTimeout fallback", {
            messageId,
            error: String(error),
          })
        }
      }
    }, 0)
    return
  }

  queueMicrotask(() => {
    let shouldCloseDb = true

    try {
      if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
        log(`[ultrawork-db-override] Deferred DB update (attempt ${attempt}): ${targetModel.providerID}/${targetModel.modelID}`, { messageId })
        return
      }

      shouldCloseDb = false
      retryViaMicrotask(db, messageId, targetModel, variant, attempt + 1)
    } catch (error) {
      log("[ultrawork-db-override] Deferred DB update failed with error", {
        messageId,
        attempt,
        error: String(error),
      })
    } finally {
      if (shouldCloseDb) {
        try {
          db.close()
        } catch (error) {
          log("[ultrawork-db-override] Failed to close DB after deferred DB update", {
            messageId,
            attempt,
            error: String(error),
          })
        }
      }
    }
  })
}

/**
 * Schedules a deferred SQLite update to change the message model in the DB
 * WITHOUT triggering a Bus event. Uses microtask retry loop to wait for
 * Session.updateMessage() to save the message first, then overwrites the model.
 *
 * Falls back to setTimeout(fn, 0) after 10 microtask attempts.
 */
export function scheduleDeferredModelOverride(
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant?: string,
): void {
  queueMicrotask(async () => {
    const sqliteModule = await importBunSqlite()
    const Database = sqliteModule?.Database
    if (typeof Database !== "function") {
      log("[ultrawork-db-override] bun:sqlite unavailable, skipping deferred override", { messageId })
      return
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      log("[ultrawork-db-override] DB not found, skipping deferred override")
      return
    }

    let db: BunDatabase
    try {
      db = new Database(dbPath)
    } catch (error) {
      log("[ultrawork-db-override] Failed to open DB, skipping deferred override", {
        messageId,
        error: String(error),
      })
      return
    }

    try {
      retryViaMicrotask(db, messageId, targetModel, variant, 0)
    } catch (error) {
      log("[ultrawork-db-override] Failed to apply deferred model override", {
        error: String(error),
      })
      db.close()
    }
  })
}