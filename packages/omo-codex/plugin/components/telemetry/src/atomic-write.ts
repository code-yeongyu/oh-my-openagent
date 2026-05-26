import { renameSync, unlinkSync, writeFileSync } from "node:fs"

export function writeFileAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, content, "utf-8")

  try {
    renameSync(tempPath, filePath)
  } catch (error) {
    const isPermissionError =
      error instanceof Error &&
      (error.message.includes("EPERM") || error.message.includes("EACCES"))

    if (process.platform === "win32" && isPermissionError) {
      unlinkSync(filePath)
      renameSync(tempPath, filePath)
      return
    }

    throw error
  }
}
