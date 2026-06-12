import {
  closeSync,
  fsyncSync,
  type fsyncSync as FsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

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
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, content, "utf-8")
  const tempFileDescriptor = openSync(tempPath, "r+")
  try {
    tolerantFsyncSync(tempFileDescriptor, options.fsyncSync ?? fsyncSync)
  } finally {
    closeSync(tempFileDescriptor)
  }

  try {
    renameSync(tempPath, filePath)
  } catch (error) {
    const isPermissionError =
      error instanceof Error &&
      (error.message.includes("EPERM") || error.message.includes("EACCES"))

    if ((options.platform ?? process.platform) === "win32" && isPermissionError) {
      unlinkSync(filePath)
      renameSync(tempPath, filePath)
      return
    }

    throw error
  }
}
