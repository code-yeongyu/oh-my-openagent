import {
  chmodSync,
  closeSync,
  type fsyncSync as FsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"

import { tolerantFsyncSync } from "./tolerant-fsync"

export function writeFileAtomically(
  filePath: string,
  content: string,
  deps: {
    fsyncSync?: typeof FsyncSync
    mode?: number
    beforeRenameSync?: (tempPath: string) => void
  } = {},
): void {
  const tempPath = `${filePath}.tmp`
  const mode = deps.mode
  writeFileSync(tempPath, content, { encoding: "utf-8", mode })
  if (mode !== undefined) {
    chmodSync(tempPath, mode)
  }
  const tempFileDescriptor = openSync(tempPath, "r+")
  try {
    tolerantFsyncSync(tempFileDescriptor, `writeFileAtomically:${filePath}`, deps.fsyncSync)
  } finally {
    closeSync(tempFileDescriptor)
  }

  try {
    deps.beforeRenameSync?.(tempPath)
    renameSync(tempPath, filePath)
  } catch (error) {
    const isWindows = process.platform === "win32"
    const isPermissionError =
      error instanceof Error &&
      (error.message.includes("EPERM") || error.message.includes("EACCES"))

    if (isWindows && isPermissionError) {
      unlinkSync(filePath)
      renameSync(tempPath, filePath)
    } else {
      throw error
    }
  }
  if (mode !== undefined) {
    chmodSync(filePath, mode)
  }
}
