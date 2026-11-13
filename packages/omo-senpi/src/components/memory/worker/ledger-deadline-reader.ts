import { readFileSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"

type LedgerDeadline = { readonly queued?: boolean; readonly deadlineAt: number }

/**
 * Reads the parent's completion deadline from the live run ledger: none while the run is queued.
 * It runs inside timer, fs.watch and promise-executor callbacks, where a throw would be an uncaught
 * exception in the user's session, so a failed read (a Windows sharing error mid-rename, a torn or
 * missing file) keeps the last deadline it read instead of throwing; the next read retries.
 */
export function createLedgerDeadlineReader(
  runDir: string,
  marginMs: number,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): () => number | undefined {
  const ledgerPath = join(runDir, "ledger.json")
  let lastRead: number | undefined
  return () => {
    try {
      const current = JSON.parse(read(ledgerPath)) as LedgerDeadline
      lastRead = current.queued === true ? undefined : current.deadlineAt + marginMs
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
    return lastRead
  }
}
