// Identity-scoped needs-human watermark, modeled on soul/watermark.ts. The file records which
// agreements were already announced as needs-human; each newly flagged item is returned exactly once,
// and an item the person acknowledged (status back to active) leaves the watermark so a later
// re-flag is announced again. Read, decision, and replacement run under the identity's notice lock.

import { join } from "node:path"

import { mkdir, readFile, rename, writeFile } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { LockContentionError, createLockRecord, noticeLockPath, withLock } from "../locks"
import { agreementItemsOf, readAgreementsAt } from "./ledger-file"
import type { AgreementItem } from "./types"

export const AGREEMENTS_NOTICE_WATERMARK_FILENAME = "agreements-flagged.json"

export interface ConsumeAgreementsNoticeOptions {
  readonly noticesDir: string
  readonly locksDir: string
  readonly waitTimeoutMs?: number
}

interface FlaggedWatermark {
  readonly version: 1
  readonly announced: readonly string[]
}

export async function consumeAgreementsNoticeDelta(
  repo: GitMemoryRepo,
  options: ConsumeAgreementsNoticeOptions,
): Promise<readonly AgreementItem[]> {
  const record = await createLockRecord("agreements notice watermark")
  try {
    return await withLock(
      noticeLockPath(options.locksDir),
      record,
      () => consumeUnderLock(repo, options.noticesDir),
      { waitTimeoutMs: options.waitTimeoutMs ?? 2_000 },
    )
  } catch (error) {
    if (error instanceof LockContentionError) return []
    throw error
  }
}

async function consumeUnderLock(repo: GitMemoryRepo, noticesDir: string): Promise<readonly AgreementItem[]> {
  const head = await repo.head()
  if (head === null) return []
  const flagged = agreementItemsOf(await readAgreementsAt(repo, head)).filter((item) => item.status === "needs-human")
  const announced = await readWatermark(noticesDir)
  const fresh = flagged.filter((item) => !announced.has(item.id))
  const next = flagged.map((item) => item.id).sort()
  if (fresh.length > 0 || next.length !== announced.size) await writeWatermark(noticesDir, next)
  return fresh
}

async function readWatermark(noticesDir: string): Promise<ReadonlySet<string>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(noticesDir, AGREEMENTS_NOTICE_WATERMARK_FILENAME), "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) return new Set()
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Set()
    throw error
  }
  if (!isWatermark(parsed)) return new Set()
  return new Set(parsed.announced)
}

function isWatermark(value: unknown): value is FlaggedWatermark {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  if (!("version" in value) || value.version !== 1 || !("announced" in value)) return false
  return Array.isArray(value.announced) && value.announced.every((id) => typeof id === "string")
}

async function writeWatermark(noticesDir: string, announced: readonly string[]): Promise<void> {
  await mkdir(noticesDir, { recursive: true, mode: 0o700 })
  const target = join(noticesDir, AGREEMENTS_NOTICE_WATERMARK_FILENAME)
  const temporary = `${target}.tmp-${process.pid}`
  const watermark: FlaggedWatermark = { version: 1, announced }
  await writeFile(temporary, `${JSON.stringify(watermark)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
}
