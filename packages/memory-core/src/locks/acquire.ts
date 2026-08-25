import { randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, stat, unlink } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"

import type { LockRecord } from "./lock-record"
import { parseLockRecord } from "./lock-record"
import { getPidLiveness, getProcessStartIdentity } from "./process-identity"

export type AcquireLockOptions = {
  readonly waitTimeoutMs?: number
  readonly retryDelayMs?: number
  readonly signal?: AbortSignal
}

type OwnerSnapshot = {
  readonly raw: string
  readonly record: LockRecord | null
}

export class LockContentionError extends Error {
  readonly retriable = true

  constructor(
    readonly lockPath: string,
    readonly owner: LockRecord | null,
  ) {
    super(`Lock is held: ${lockPath}`)
    this.name = "LockContentionError"
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    const onAbort = () => finish(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    signal?.addEventListener("abort", onAbort, { once: true })
    function finish(error?: unknown) {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      error === undefined ? resolve() : reject(error)
    }
  })
}

async function readOwner(lockPath: string): Promise<OwnerSnapshot | null> {
  try {
    const raw = await readFile(lockPath, "utf8")
    return { raw, record: parseLockRecord(raw) }
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") return null
    if (path.sep === "\\" && code === "EPERM") return { raw: "", record: null }
    throw error
  }
}

async function publishExclusive(lockPath: string, record: LockRecord): Promise<boolean> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  const candidatePath = `${lockPath}.candidate-${randomUUID()}`
  try {
    const handle = await open(candidatePath, "wx", 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await link(candidatePath, lockPath)
      return true
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false
      throw error
    }
  } finally {
    await unlink(candidatePath).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error
    })
  }
}

async function isProvenDead(owner: LockRecord): Promise<boolean> {
  if (owner.hostname !== hostname()) return false
  const liveness = getPidLiveness(owner.pid)
  if (liveness === "dead") return true
  if (liveness === "unknown") return false

  const actualStart = await getProcessStartIdentity(owner.pid)
  if (actualStart === null || owner.process_start === "unavailable") return false
  return actualStart !== owner.process_start
}

async function recoverDeadOwner(
  lockPath: string,
  snapshot: OwnerSnapshot,
  contender: LockRecord,
): Promise<boolean> {
  if (snapshot.record === null || !(await isProvenDead(snapshot.record))) return false

  const recoveryPath = `${lockPath}.recovery`
  const recoveryRecord: LockRecord = {
    ...contender,
    nonce: randomUUID(),
    created_at: new Date().toISOString(),
    purpose: `${contender.purpose}:recovery`,
  }
  if (!(await publishExclusive(recoveryPath, recoveryRecord))) return false

  try {
    const current = await readOwner(lockPath)
    if (current === null) return true
    if (current.raw !== snapshot.raw || current.record === null) return false
    if (!(await isProvenDead(current.record))) return false
    await unlink(lockPath)
    return true
  } finally {
    await releaseLock(recoveryPath, recoveryRecord)
  }
}

export async function acquireLock(
  lockPath: string,
  record: LockRecord,
  options: AcquireLockOptions = {},
): Promise<void> {
  const waitTimeoutMs = options.waitTimeoutMs ?? 0
  const retryDelayMs = options.retryDelayMs ?? 25
  if (waitTimeoutMs < 0 || retryDelayMs <= 0) throw new Error("lock wait options must be positive")
  const deadline = Date.now() + waitTimeoutMs

  for (;;) {
    options.signal?.throwIfAborted()
    if (await publishExclusive(lockPath, record)) return
    options.signal?.throwIfAborted()
    const owner = await readOwner(lockPath)
    if (owner === null) continue
    if (await recoverDeadOwner(lockPath, owner, record)) continue
    options.signal?.throwIfAborted()
    if (Date.now() >= deadline) throw new LockContentionError(lockPath, owner.record)
    await delay(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())), options.signal)
  }
}

export async function releaseLock(lockPath: string, record: Pick<LockRecord, "nonce">): Promise<boolean> {
  const owner = await readOwner(lockPath)
  if (owner === null || owner.record?.nonce !== record.nonce) return false
  try {
    await unlink(lockPath)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}

export async function withLock<T>(
  lockPath: string,
  record: LockRecord,
  fn: () => Promise<T>,
  options?: AcquireLockOptions,
): Promise<T> {
  await acquireLock(lockPath, record, options)
  try {
    return await fn()
  } finally {
    await releaseLock(lockPath, record)
  }
}

export async function isHeld(lockPath: string): Promise<boolean> {
  try {
    await stat(lockPath)
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}
