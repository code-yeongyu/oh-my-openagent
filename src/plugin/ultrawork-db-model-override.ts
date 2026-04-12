import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { getDataDir } from "../shared/data-path"
import { log } from "../shared"

function getDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

const MAX_MICROTASK_RETRIES = 10

async function executeWithBackoff<T>(fn: () => T, maxRetries = 10, baseDelayMs = 50): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return fn();
    } catch (error: any) {
      const isBusy = error.code === "SQLITE_BUSY" || String(error).includes("SQLITE_BUSY") || String(error).includes("database is locked");
      if (attempt >= maxRetries || !isBusy) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(1.5, attempt) + Math.random() * 10;
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
}

async function tryUpdateMessageModel(
  db: InstanceType<typeof Database>,
  messageId: string,
  targetModel: { providerID: string; modelID: string },
  variant?: string,
): Promise<boolean> {
  return executeWithBackoff(() => {
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
  })
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
    setTimeout(async () => {
      try {
        if (await tryUpdateMessageModel(db, messageId, targetModel, variant)) {
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

  queueMicrotask(async () => {
    let shouldCloseDb = true

    try {
      if (await tryUpdateMessageModel(db, messageId, targetModel, variant)) {
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
  queueMicrotask(() => {
    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
      log("[ultrawork-db-override] DB not found, skipping deferred override")
      return
    }

    let db: InstanceType<typeof Database>
    try {
      db = new Database(dbPath)
      db.exec("PRAGMA journal_mode = WAL;")
      db.exec("PRAGMA busy_timeout = 60000;")
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
