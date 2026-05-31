import { fsyncSync } from "node:fs"
import type { FileHandle } from "node:fs/promises"

import { classifyPathEnvironment } from "./classify-path-environment"
import { recordFsyncSkip } from "./fsync-skip-tracker"
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

function extractPathFromContextLabel(contextLabel: string): string {
  const separatorIndex = contextLabel.indexOf(":")
  if (separatorIndex < 0) return contextLabel

  return contextLabel.slice(separatorIndex + 1)
}

export async function tolerantFsync(
  fileHandle: FileHandle,
  contextLabel: string,
): Promise<void> {
  try {
    await fileHandle.sync()
  } catch (error) {
    if (!isToleratedFsyncError(error)) throw error
    const errorCode = (error as NodeJS.ErrnoException).code ?? "UNKNOWN"
    const message = error instanceof Error ? error.message : String(error)
    const filePath = extractPathFromContextLabel(contextLabel)

    log("fsync skipped due to filesystem limitation", {
      event: "fsync-skipped",
      contextLabel,
      code: errorCode,
      message,
    })

    recordFsyncSkip({
      filePath,
      contextLabel,
      errorCode,
      message,
      pathClassification: classifyPathEnvironment(filePath),
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
    const errorCode = (error as NodeJS.ErrnoException).code ?? "UNKNOWN"
    const message = error instanceof Error ? error.message : String(error)
    const filePath = extractPathFromContextLabel(contextLabel)

    log("fsync skipped due to filesystem limitation", {
      event: "fsync-skipped",
      contextLabel,
      code: errorCode,
      message,
    })

    recordFsyncSkip({
      filePath,
      contextLabel,
      errorCode,
      message,
      pathClassification: classifyPathEnvironment(filePath),
    })
  }
}
