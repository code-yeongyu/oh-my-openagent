// Identity-scoped needs-human watermark, modeled on soul/watermark.ts. The file records which
// agreements were already announced as needs-human; each newly flagged item is returned exactly once,
// and an item the person acknowledged (status back to active) leaves the watermark so a later
// re-flag is announced again. Read, decision, and replacement run under the identity's notice lock.

import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { mkdir, readFileSync, rename, rm, writeFile } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { syncJournalDirectory } from "../journal/fsync"
import { LockContentionError, createLockRecord, noticeLockPath, withLock } from "../locks"
import { agreementItemsOf, readAgreementsAt } from "./ledger-file"
import type { AgreementItem } from "./types"

type WarnSink = NonNullable<ConsumeAgreementsNoticeOptions["onWarn"]>

export const AGREEMENTS_NOTICE_WATERMARK_FILENAME = "agreements-flagged.json"

export interface ConsumeAgreementsNoticeOptions {
  readonly noticesDir: string
  readonly locksDir: string
  readonly waitTimeoutMs?: number
  /** Receives non-fatal warnings; defaults to a no-op so a host TUI is never written to. */
  readonly onWarn?: (message: string, detail?: unknown) => void
}

interface FlaggedWatermark {
  readonly version: 1
  readonly announced: readonly string[]
}

export async function consumeAgreementsNoticeDelta(
  repo: GitMemoryRepo,
  options: ConsumeAgreementsNoticeOptions,
): Promise<readonly AgreementItem[]> {
  const head = await repo.head()
  if (head !== null) {
    const flagged = agreementItemsOf(await readAgreementsAt(repo, head)).filter((item) => item.status === "needs-human")
    let announced: ReadonlySet<string> | undefined
    try {
      announced = readWatermark(options.noticesDir)
    } catch {
      // Retry an anomalous optimistic read under the lock, preserving locked-path errors.
      announced = undefined
    }
    // No mutation or notice is needed. A differing set, including an acknowledgement,
    // must still be read again under the lock before consuming or replacing the watermark.
    const flaggedIds = new Set(flagged.map((item) => item.id))
    if (announced !== undefined && flaggedIds.size === announced.size && [...flaggedIds].every((id) => announced.has(id))) return []
  }
  const record = await createLockRecord("agreements notice watermark")
  try {
    return await withLock(
      noticeLockPath(options.locksDir),
      record,
      () => consumeUnderLock(repo, options.noticesDir, options.onWarn),
      { waitTimeoutMs: options.waitTimeoutMs ?? 2_000 },
    )
  } catch (error) {
    if (error instanceof LockContentionError) return []
    throw error
  }
}

async function consumeUnderLock(repo: GitMemoryRepo, noticesDir: string, onWarn?: WarnSink): Promise<readonly AgreementItem[]> {
  const head = await repo.head()
  if (head === null) return []
  const flagged = agreementItemsOf(await readAgreementsAt(repo, head)).filter((item) => item.status === "needs-human")
  const announced = readWatermark(noticesDir)
  const fresh = flagged.filter((item) => !announced?.has(item.id))
  const next = [...new Set(flagged.map((item) => item.id))].sort()
  if (fresh.length > 0 || next.length !== announced?.size) await writeWatermark(noticesDir, next, onWarn)
  return fresh
}

function readWatermark(noticesDir: string): ReadonlySet<string> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(noticesDir, AGREEMENTS_NOTICE_WATERMARK_FILENAME), "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
  if (!isWatermark(parsed)) return undefined
  return new Set(parsed.announced)
}

function isWatermark(value: unknown): value is FlaggedWatermark {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  if (!("version" in value) || value.version !== 1 || !("announced" in value)) return false
  return Array.isArray(value.announced) && value.announced.every((id) => typeof id === "string")
}

async function writeWatermark(noticesDir: string, announced: readonly string[], onWarn?: WarnSink): Promise<void> {
  await mkdir(noticesDir, { recursive: true, mode: 0o700 })
  const target = join(noticesDir, AGREEMENTS_NOTICE_WATERMARK_FILENAME)
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
  const watermark: FlaggedWatermark = { version: 1, announced }
  try {
    await writeFile(temporary, `${JSON.stringify(watermark)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx", flush: true })
    await rename(temporary, target)
  } catch (error) {
    // Cleanup is best-effort: a failing rm must not replace the original write/rename error.
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  try {
    await syncJournalDirectory(noticesDir)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error
    // Rename already consumed this notice. A durability failure must not discard its announcement.
    onWarn?.("[memory] Published agreements watermark directory sync failed:", error.code)
  }
}
