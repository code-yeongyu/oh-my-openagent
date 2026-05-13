import {
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
  deps: { fsyncSync?: typeof FsyncSync } = {},
): void {
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, content, "utf-8")
  const tempFileDescriptor = openSync(tempPath, "r")
  try {
    tolerantFsyncSync(tempFileDescriptor, `writeFileAtomically:${filePath}`, deps.fsyncSync)
  } finally {
    closeSync(tempFileDescriptor)
  }

  try {
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
}
