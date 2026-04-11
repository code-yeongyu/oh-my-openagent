import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs"

export function writeFileAtomically(filePath: string, content: string): void {
	const tempPath = `${filePath}.tmp`
	writeFileSync(tempPath, content, "utf-8")
  const tempFileDescriptor = openSync(tempPath, "r")
  try {
    fsyncSync(tempFileDescriptor)
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
