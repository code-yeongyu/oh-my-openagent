import {
  chmodSync,
  closeSync,
  type fsyncSync as FsyncSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"

import { tolerantFsyncSync } from "./tolerant-fsync"

export function writeFileAtomically(
  filePath: string,
  content: string,
  deps: {
    fsyncSync?: typeof FsyncSync
    mode?: number
    beforeRenameSync?: (tempPath: string) => void
    renameSync?: typeof renameSync
  } = {},
): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const mode = deps.mode
  try {
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

    const renameFileSync = deps.renameSync ?? renameSync
    try {
      deps.beforeRenameSync?.(tempPath)
      renameFileSync(tempPath, filePath)
    } catch (error) {
      const isWindows = process.platform === "win32"
      const isPermissionError =
        error instanceof Error &&
        (error.message.includes("EPERM") || error.message.includes("EACCES"))

      if (isWindows && isPermissionError) {
        unlinkSync(filePath)
        renameFileSync(tempPath, filePath)
      } else {
        throw error
      }
    }
    if (mode !== undefined) {
      chmodSync(filePath, mode)
    }
  } finally {
    rmSync(tempPath, { force: true })
  }
}
