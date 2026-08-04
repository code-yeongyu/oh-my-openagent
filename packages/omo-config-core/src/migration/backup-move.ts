import type { MigrationFileSystem } from "./types"

function isCrossDeviceError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "EXDEV"
}

export function moveMigrationBackup(
  fileSystem: MigrationFileSystem,
  sourcePath: string,
  backupPath: string,
): void {
  try {
    fileSystem.renameSync(sourcePath, backupPath)
  } catch (error) {
    if (!isCrossDeviceError(error)) throw error
    fileSystem.copyFileSync(sourcePath, backupPath)
    fileSystem.unlinkSync(sourcePath)
  }
}
