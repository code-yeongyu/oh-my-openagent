import { statSync } from "node:fs"

/**
 * The code a store call fails with when the worker's connection no longer reaches the database other
 * processes use: SQLite answered an I/O error, or the `-wal`/`-shm` files the connection opened were
 * unlinked or replaced under it (a foreign client that takes itself for the last connection deletes them
 * on close, and writes made after that land in the unlinked WAL, where nobody else ever reads them). It
 * crosses the worker boundary as `code`; the facade closes that worker and runs the call once more on a
 * fresh connection.
 */
export const CONNECTION_LOST_CODE = "gateway_store_connection_lost"

export function connectionLost(reason: string): Error & { readonly code: string } {
  return Object.assign(new Error(`gateway store connection lost: ${reason}`), { code: CONNECTION_LOST_CODE })
}

export function isConnectionLost(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === CONNECTION_LOST_CODE
  )
}

/** SQLITE_IOERR; extended I/O codes keep it in the low byte. */
const SQLITE_IOERR = 10

export function isSqliteIoError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const record = error as { readonly errcode?: unknown; readonly message?: unknown }
  return (
    (typeof record.errcode === "number" && (record.errcode & 0xff) === SQLITE_IOERR) ||
    (typeof record.message === "string" && /disk I\/O error/i.test(record.message))
  )
}

type FileIdentity = { readonly dev: number; readonly ino: number }

/**
 * Remembers the `-wal` and `-shm` files an open connection uses, by device and inode, the first time each
 * is seen, and names the one that has since been removed or replaced. While any connection is open SQLite
 * never removes them, so either means the connection is writing where no other process reads.
 */
export function watchWalFiles(databasePath: string): () => string | undefined {
  const seen = new Map<string, FileIdentity>()
  return () => {
    for (const suffix of ["-wal", "-shm"]) {
      const stat = statSync(`${databasePath}${suffix}`, { throwIfNoEntry: false })
      const known = seen.get(suffix)
      if (known === undefined) {
        if (stat !== undefined) seen.set(suffix, { dev: stat.dev, ino: stat.ino })
        continue
      }
      if (stat === undefined) return `${suffix} was removed while the connection was open`
      if (stat.dev !== known.dev || stat.ino !== known.ino)
        return `${suffix} was replaced while the connection was open`
    }
    return undefined
  }
}
