import {
  closeSync,
  fsyncSync,
  type fsyncSync as FsyncSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"

const TOLERATED_FSYNC_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EINVAL",
])

export interface AtomicWriteOptions {
  readonly platform?: NodeJS.Platform
  readonly fsyncSync?: typeof FsyncSync
}

function isToleratedFsyncError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code !== undefined && TOLERATED_FSYNC_CODES.has(code)
}

function tolerantFsyncSync(
  fileDescriptor: number,
  fsyncImpl: typeof FsyncSync,
): void {
  try {
    fsyncImpl(fileDescriptor)
  } catch (error) {
    if (!isToleratedFsyncError(error)) throw error
  }
}

export function writeFileAtomically(filePath: string, content: string, options: AtomicWriteOptions = {}): void {
  const platform = options.platform ?? process.platform
  const fsyncImpl = options.fsyncSync ?? fsyncSync
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tempPath, content, "utf-8")
    const tempFileDescriptor = openSync(tempPath, "r+")
    try {
      tolerantFsyncSync(tempFileDescriptor, fsyncImpl)
    } finally {
      closeSync(tempFileDescriptor)
    }

    try {
      renameSync(tempPath, filePath)
    } catch (error) {
      const isPermissionError =
        error instanceof Error &&
        (error.message.includes("EPERM") || error.message.includes("EACCES"))

      if (platform !== "win32" || !isPermissionError) throw error
      unlinkSync(filePath)
      renameSync(tempPath, filePath)
    }

    if (platform === "win32") return
    const directoryFileDescriptor = openSync(dirname(filePath), "r")
    try {
      tolerantFsyncSync(directoryFileDescriptor, fsyncImpl)
    } finally {
      closeSync(directoryFileDescriptor)
    }
  } finally {
    rmSync(tempPath, { force: true })
  }
}
