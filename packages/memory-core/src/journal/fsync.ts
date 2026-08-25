// Durability primitives for the journal flush (IC-11). Files are fsynced through their own
// handle; the directory fsync is the POSIX affordance that makes the renames durable and is
// simply unavailable on Windows, where a directory handle cannot be opened for sync.

import { open } from "node:fs/promises"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

/** Codes Windows raises for a directory handle, plus the absent-file case. */
const SKIPPABLE_SYNC_CODES = new Set(["ENOENT", "EISDIR", "EPERM", "EACCES", "EINVAL"])

async function syncHandle(path: string): Promise<void> {
  let handle
  try {
    handle = await open(path, "r")
  } catch (error) {
    if (SKIPPABLE_SYNC_CODES.has(errorCode(error) ?? "")) return
    throw error
  }
  try {
    await handle.sync()
  } catch (error) {
    if (!SKIPPABLE_SYNC_CODES.has(errorCode(error) ?? "")) throw error
  } finally {
    await handle.close()
  }
}

/** fsyncs a journal file. A file that was never created is nothing to make durable. */
export async function syncJournalFile(path: string): Promise<void> {
  await syncHandle(path)
}

/** fsyncs the journal directory so the state rename is durable where the platform allows it. */
export async function syncJournalDirectory(dir: string): Promise<void> {
  await syncHandle(dir)
}
