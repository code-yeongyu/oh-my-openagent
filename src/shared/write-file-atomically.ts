import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs"

export function writeFileAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, content, "utf-8")
  const tempFileDescriptor = openSync(tempPath, "r")
  try {
    fsyncSync(tempFileDescriptor)
  } finally {
    closeSync(tempFileDescriptor)
  }
  renameSync(tempPath, filePath)
}
