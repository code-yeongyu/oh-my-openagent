import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export interface BackupResult {
  success: boolean
  backupPath?: string
  error?: string
}

export function backupConfigFile(configPath: string): BackupResult {
  if (!existsSync(configPath)) {
    return { success: true }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupPath = `${configPath}.backup-${timestamp}`

  try {
    const dir = dirname(backupPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    copyFileSync(configPath, backupPath)
    return { success: true, backupPath }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create backup",
    }
  }
}
