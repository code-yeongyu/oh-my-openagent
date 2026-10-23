import type { MigrationFileSystem } from "./types"
import { randomUUID } from "node:crypto"

function isCrossDeviceError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "EXDEV"
}

export function moveMigrationBackup(
  fileSystem: MigrationFileSystem,
  sourcePath: string,
  backupPath: string,
): void {
  // Moving a link must never change its target's mode or replace it with a dereferenced copy.
  if (!fileSystem.lstatSync(sourcePath).isSymbolicLink()) {
    const temporaryPath = `${backupPath}.${randomUUID()}.tmp`
    fileSystem.writeFileExclusiveSync(temporaryPath, fileSystem.readFileSync(sourcePath, "utf-8"))
    try {
      try {
        fileSystem.renameSync(temporaryPath, backupPath)
      } catch (error) {
        if (!isCrossDeviceError(error)) throw error
        fileSystem.copyFileSync(temporaryPath, backupPath)
        fileSystem.unlinkSync(temporaryPath)
      }
    } catch (error) {
      fileSystem.unlinkSync(temporaryPath)
      throw error
    }
    fileSystem.unlinkSync(sourcePath)
    return
  }
  try {
    fileSystem.renameSync(sourcePath, backupPath)
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error
    fileSystem.copyFileSync(sourcePath, backupPath)
    fileSystem.unlinkSync(sourcePath)
  }
}
