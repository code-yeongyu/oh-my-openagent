import { join } from "node:path"
import { existsSync } from "node:fs"
import { getDataDir } from "../shared/data-path"
import { log } from "../shared"

type BunDatabase = import("bun:sqlite").Database
type BunStatement = ReturnType<BunDatabase["prepare"]>

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
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    return null
  }
}

function getDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

const MAX_MICROTASK_RETRIES = 10

function logCaughtDbError(
  message: string,
  metadata: Record<string, string | number | undefined>,
  error: unknown,
): void {
  log(message, { ...metadata, error: String(error) })
}

function nextMicrotask(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve)
  })
}

function nextTimerTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function closeDbWithLog(db: BunDatabase, message: string, metadata: Record<string, string | number | undefined>): void {
  try {
    db.close()
  } catch (error) {
    logCaughtDbError(message, metadata, error)
    if (error instanceof Error) return
  }
}

function finalizeStatementWithLog(stmt: BunStatement, message: string, metadata: Record<string, string | number | undefined>): void {
  try {
    stmt.finalize()
  } catch (error) {
    logCaughtDbError(message, metadata, error)
    if (error instanceof Error) return
  }
}

function tryUpdateMessageModel(
  db: BunDatabase,
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant?: string,
): boolean {
  const stmt = db.prepare(
    `UPDATE message SET data = json_set(data, '$.model.providerID', ?, '$.model.modelID', ?) WHERE id = ?`,
  )
  try {
    const result = stmt.run(targetModel.providerID, targetModel.modelID, messageId)
    if (result.changes === 0) return false
  } finally {
    finalizeStatementWithLog(stmt, "[ultrawork-db-override] Failed to finalize model update statement", { messageId })
  }

  if (variant) {
    const variantStmt = db.prepare(
      `UPDATE message SET data = json_set(data, '$.variant', ?, '$.thinking', ?) WHERE id = ?`,
    )
    try {
      variantStmt.run(variant, variant, messageId)
    } finally {
      finalizeStatementWithLog(variantStmt, "[ultrawork-db-override] Failed to finalize variant update statement", { messageId })
    }
  }
  return true
}

async function retryViaMicrotask(
  db: BunDatabase,
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant: string | undefined,
  attempt: number,
): Promise<void> {
  if (attempt >= MAX_MICROTASK_RETRIES) {
    log("[ultrawork-db-override] Exhausted microtask retries, falling back to setTimeout", {
      messageId,
      attempt,
    })
    await nextTimerTick()
    try {
      if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
        log(`[ultrawork-db-override] setTimeout fallback succeeded: ${targetModel.providerID}/${targetModel.modelID}`, { messageId })
      } else {
        log("[ultrawork-db-override] setTimeout fallback failed - message not found", { messageId })
      }
    } catch (error) {
      logCaughtDbError("[ultrawork-db-override] setTimeout fallback failed with error", { messageId }, error)
      if (error instanceof Error) return
    } finally {
      closeDbWithLog(db, "[ultrawork-db-override] Failed to close DB after setTimeout fallback", { messageId })
    }
    return
  }

  await nextMicrotask()
  let shouldCloseDb = true

  try {
    if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
      log(`[ultrawork-db-override] Deferred DB update (attempt ${attempt}): ${targetModel.providerID}/${targetModel.modelID}`, { messageId })
      return
    }

    shouldCloseDb = false
    await retryViaMicrotask(db, messageId, targetModel, variant, attempt + 1)
  } catch (error) {
    logCaughtDbError("[ultrawork-db-override] Deferred DB update failed with error", { messageId, attempt }, error)
    if (error instanceof Error) return
  } finally {
    if (shouldCloseDb) {
      closeDbWithLog(db, "[ultrawork-db-override] Failed to close DB after deferred DB update", { messageId, attempt })
    }
  }
}

/**
 * Schedules a deferred SQLite update to change the message model in the DB
 * WITHOUT triggering a Bus event. Uses microtask retry loop to wait for
 * Session.updateMessage() to save the message first, then overwrites the model.
 *
 * Falls back to setTimeout(fn, 0) after 10 microtask attempts.
 */
export async function scheduleDeferredModelOverride(
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant?: string,
): Promise<void> {
  await nextMicrotask()
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
    logCaughtDbError("[ultrawork-db-override] Failed to open DB, skipping deferred override", { messageId }, error)
    if (error instanceof Error) return
    return
  }

  try {
    await retryViaMicrotask(db, messageId, targetModel, variant, 0)
  } catch (error) {
    logCaughtDbError("[ultrawork-db-override] Failed to apply deferred model override", {}, error)
    closeDbWithLog(db, "[ultrawork-db-override] Failed to close DB after deferred override error", { messageId })
    if (error instanceof Error) return
  }
}
