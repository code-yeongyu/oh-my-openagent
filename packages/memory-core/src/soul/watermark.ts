// Identity-scoped soul-notice watermark (plan IC-5). One watermark per identity
// at runtime/notices/soul-head.json; sessionId never participates. An absent or
// unreadable watermark is established silently at HEAD (history is never
// replayed). Thereafter a notice is emitted exactly once per advancement: the
// delta is the newest commit in <watermark>..HEAD touching a soul path that was
// NOT authored in-band (no `Omo-Writer: memory-tool` trailer), and the watermark
// advances to HEAD exactly when that notice is consumed. The read, delta
// decision, and watermark replacement are serialized under the identity-scoped
// `notice` lock so concurrent sessions bound to the same identity cannot both
// emit and both advance.

import { mkdir, readFile, rename, writeFile } from "../fs/resilient"
import { join } from "node:path"

import { GitCommandError, type GitMemoryRepo } from "../git"
import { LockContentionError, createLockRecord, noticeLockPath, withLock } from "../locks"
import { SOUL_PATHS } from "./paths"

export const SOUL_NOTICE_WATERMARK_FILENAME = "soul-head.json"

export interface SoulNotice {
  readonly sha: string
  readonly subject: string
}

export interface ConsumeSoulNoticeOptions {
  readonly noticesDir: string
  readonly locksDir: string
  /** Lock wait budget; defaults to 2000ms. Contention defers the notice to the next compile. */
  readonly waitTimeoutMs?: number
}

interface SoulHeadWatermark {
  readonly version: 1
  readonly lastNotifiedHead: string
}

export async function consumeSoulNoticeDelta(
  repo: GitMemoryRepo,
  options: ConsumeSoulNoticeOptions,
): Promise<SoulNotice | undefined> {
  const record = await createLockRecord("soul notice watermark")
  try {
    return await withLock(
      noticeLockPath(options.locksDir),
      record,
      () => consumeUnderLock(repo, options.noticesDir),
      { waitTimeoutMs: options.waitTimeoutMs ?? 2_000 },
    )
  } catch (error) {
    if (error instanceof LockContentionError) return undefined
    throw error
  }
}

async function consumeUnderLock(
  repo: GitMemoryRepo,
  noticesDir: string,
): Promise<SoulNotice | undefined> {
  const head = await repo.head()
  if (head === null) return undefined
  const watermark = await readWatermark(noticesDir)
  if (watermark === undefined) {
    await writeWatermark(noticesDir, head)
    return undefined
  }
  if (watermark.lastNotifiedHead === head) return undefined

  let commits
  try {
    commits = await repo.log({ range: `${watermark.lastNotifiedHead}..HEAD`, paths: SOUL_PATHS })
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error
    // The recorded head left history (rewritten by an external sync): re-establish
    // silently rather than replay a range that can no longer be computed.
    await writeWatermark(noticesDir, head)
    return undefined
  }

  const newest = commits.find((commit) => commit.trailers["Omo-Writer"] !== "memory-tool")
  if (newest === undefined) return undefined
  await writeWatermark(noticesDir, head)
  return { sha: newest.sha, subject: newest.subject }
}

async function readWatermark(noticesDir: string): Promise<SoulHeadWatermark | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(noticesDir, SOUL_NOTICE_WATERMARK_FILENAME), "utf8"))
  } catch {
    return undefined
  }
  if (!isWatermark(parsed)) return undefined
  return parsed
}

function isWatermark(value: unknown): value is SoulHeadWatermark {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1
    && typeof record.lastNotifiedHead === "string"
    && /^[0-9a-f]{40}$/.test(record.lastNotifiedHead)
}

async function writeWatermark(noticesDir: string, head: string): Promise<void> {
  await mkdir(noticesDir, { recursive: true, mode: 0o700 })
  const target = join(noticesDir, SOUL_NOTICE_WATERMARK_FILENAME)
  const temporary = `${target}.tmp-${process.pid}`
  const watermark: SoulHeadWatermark = { version: 1, lastNotifiedHead: head }
  await writeFile(temporary, `${JSON.stringify(watermark)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, target)
}
