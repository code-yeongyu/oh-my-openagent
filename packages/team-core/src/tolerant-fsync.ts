import type { FileHandle } from "node:fs/promises"

const TOLERATED_FSYNC_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "ENOTSUP", "EINVAL"])

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

export async function tolerantFsync(fileHandle: FileHandle, _contextLabel: string): Promise<void> {
  try {
    await fileHandle.sync()
  } catch (error) {
    const code = getErrorCode(error)
    if (code === undefined || !TOLERATED_FSYNC_CODES.has(code)) {
      throw error
    }
  }
}
