import { randomUUID } from "node:crypto"
import { open, readFile, rename, rm, unlink } from "node:fs/promises"

import { tolerantFsync } from "../tolerant-fsync"

type LockOptions = {
  staleAfterMs?: number
  ownerTag?: string
}

type AtomicWriteDeps = {
  open?: typeof open
  rename?: typeof rename
  rm?: typeof rm
}

const LOCK_RETRY_MS = 50
const LOCK_WAIT_TIMEOUT_MS = 15_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function buildOwnerContent(ownerTag: string): string {
  return `${ownerTag}\n${process.pid}\n${Date.now()}\n`
}

function parseOwnerContent(content: string): { ownerPid: number; acquiredAtEpochMs: number } | null {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length !== 3) return null

  const ownerPid = Number.parseInt(lines[1] ?? "", 10)
  const acquiredAtEpochMs = Number.parseInt(lines[2] ?? "", 10)
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return null
  if (!Number.isInteger(acquiredAtEpochMs) || acquiredAtEpochMs <= 0) return null

  return { ownerPid, acquiredAtEpochMs }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return false
  }
}

async function acquireLock(lockPath: string, ownerTag: string, staleAfterMs: number): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > LOCK_WAIT_TIMEOUT_MS) {
      throw new Error(`Timed out acquiring lock: ${lockPath}`)
    }

    try {
      const fileHandle = await open(lockPath, "wx")
      try {
        await fileHandle.writeFile(buildOwnerContent(ownerTag))
        await tolerantFsync(fileHandle, `acquireLock:${lockPath}`)
      } finally {
        await fileHandle.close()
      }
      return
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== "EEXIST") throw error

      if (await detectStaleLock(lockPath, staleAfterMs)) {
        await reapStaleLock(lockPath)
        continue
      }

      await delay(LOCK_RETRY_MS)
    }
  }
}

export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts?: LockOptions,
): Promise<T> {
  const staleAfterMs = opts?.staleAfterMs ?? 300_000
  const ownerTag = opts?.ownerTag ?? "owner"

  await acquireLock(lockPath, ownerTag, staleAfterMs)

  try {
    return await fn()
  } finally {
    await reapStaleLock(lockPath)
  }
}

export async function detectStaleLock(lockPath: string, staleAfterMs: number): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf8")
    const parsed = parseOwnerContent(content)
    if (parsed === null) return false

    if (isPidAlive(parsed.ownerPid)) return false

    return Date.now() - parsed.acquiredAtEpochMs > staleAfterMs
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return false
  }
}

export async function reapStaleLock(lockPath: string): Promise<void> {
  await unlink(lockPath).catch((error: unknown) => {
    if (error instanceof Error) return undefined
    return undefined
  })
}

export async function atomicWrite(
  filePath: string,
  content: string | Buffer,
  deps: AtomicWriteDeps = {},
): Promise<void> {
  const tmpPath = `${filePath}.tmp.${randomUUID()}`
  const openFile = deps.open ?? open
  const renameFile = deps.rename ?? rename
  const removeFile = deps.rm ?? rm

  try {
    const fileHandle = await openFile(tmpPath, "wx")
    try {
      await fileHandle.writeFile(content)
      await tolerantFsync(fileHandle, `atomicWrite:${filePath}`)
    } finally {
      await fileHandle.close()
    }
    await renameFile(tmpPath, filePath)
  } catch (error) {
    await removeFile(tmpPath, { force: true })
    throw error
  }
}
