import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { getDataDir } from "../shared/data-path"
import { log } from "../shared"

function getDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

const MAX_MICROTASK_RETRIES = 10

function tryUpdateMessageModel(
  db: InstanceType<typeof Database>,
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
  db: InstanceType<typeof Database>,
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
      if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
        log(`[ultrawork-db-override] setTimeout fallback succeeded: ${targetModel.providerID}/${targetModel.modelID}`, { messageId })
      } else {
        log("[ultrawork-db-override] setTimeout fallback failed - message not found", { messageId })
      }
      db.close()
    }, 0)
    return
  }

  queueMicrotask(() => {
    if (tryUpdateMessageModel(db, messageId, targetModel, variant)) {
      log(`[ultrawork-db-override] Deferred DB update (attempt ${attempt}): ${targetModel.providerID}/${targetModel.modelID}`, { messageId })
      db.close()
      return
    }
    retryViaMicrotask(db, messageId, targetModel, variant, attempt + 1)
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
  queueMicrotask(() => {
    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      log("[ultrawork-db-override] DB not found, skipping deferred override")
      return
    }

    const db = new Database(dbPath)
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
