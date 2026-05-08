import { fsyncSync } from "node:fs"
import type { FileHandle } from "node:fs/promises"

import { log } from "./logger"

const TOLERATED_FSYNC_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EINVAL",
])

export function isToleratedFsyncError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code !== undefined && TOLERATED_FSYNC_CODES.has(code)
}

export async function tolerantFsync(
  fileHandle: FileHandle,
  contextLabel: string,
): Promise<void> {
  try {
    await fileHandle.sync()
  } catch (error) {
    if (!isToleratedFsyncError(error)) throw error
    log("fsync skipped due to filesystem limitation", {
      event: "fsync-skipped",
      contextLabel,
      code: (error as NodeJS.ErrnoException).code,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function tolerantFsyncSync(
  fileDescriptor: number,
  contextLabel: string,
  fsyncImpl: typeof fsyncSync = fsyncSync,
): void {
  try {
    fsyncImpl(fileDescriptor)
  } catch (error) {
    if (!isToleratedFsyncError(error)) throw error
    log("fsync skipped due to filesystem limitation", {
      event: "fsync-skipped",
      contextLabel,
      code: (error as NodeJS.ErrnoException).code,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
