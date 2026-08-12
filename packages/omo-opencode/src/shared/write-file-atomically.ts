import {
  chmodSync,
  closeSync,
  existsSync,
  type fsyncSync as FsyncSync,
  openSync,
  realpathSync,
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
  // Write through symlinks: renaming over the symlink itself would replace it
  // with a regular file, breaking dotfiles/managed config setups.
  const targetPath = existsSync(filePath) ? realpathSync(filePath) : filePath
  const tempPath = `${targetPath}.tmp`
  const mode = deps.mode
  writeFileSync(tempPath, content, { encoding: "utf-8", mode })
  if (mode !== undefined) {
    chmodSync(tempPath, mode)
  }
  const tempFileDescriptor = openSync(tempPath, "r+")
  try {
    tolerantFsyncSync(tempFileDescriptor, `writeFileAtomically:${targetPath}`, deps.fsyncSync)
  } finally {
    closeSync(tempFileDescriptor)
  }

  try {
    deps.beforeRenameSync?.(tempPath)
    renameSync(tempPath, targetPath)
  } catch (error) {
    const isWindows = process.platform === "win32"
    const isPermissionError =
      error instanceof Error &&
      (error.message.includes("EPERM") || error.message.includes("EACCES"))

    if (isWindows && isPermissionError) {
      unlinkSync(targetPath)
      renameSync(tempPath, targetPath)
    } else {
      throw error
    }
  }
  if (mode !== undefined) {
    chmodSync(targetPath, mode)
  }
}
