import { readFile, stat, unlink } from "../fs/resilient"
import path from "node:path"

import type { LockRecord } from "./lock-record"
import { parseLockRecord } from "./lock-record"

export type OwnerSnapshot = {
  readonly raw: string
  readonly record: LockRecord | null
  readonly dev: bigint | number
  readonly ino: bigint | number
  readonly mtimeMs: number
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export async function readOwner(lockPath: string): Promise<OwnerSnapshot | null> {
  try {
    const raw = await readFile(lockPath, "utf8")
    const identity = await stat(lockPath, { bigint: true })
    return {
      raw,
      record: parseLockRecord(raw),
      dev: identity.dev,
      ino: identity.ino,
      mtimeMs: Number(identity.mtimeMs),
    }
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") return null
    if (path.sep === "\\" && code === "EPERM") return { raw: "", record: null, dev: 0, ino: 0, mtimeMs: Date.now() }
    throw error
  }
}

export function isSameOwner(left: OwnerSnapshot, right: OwnerSnapshot): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.raw === right.raw
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
