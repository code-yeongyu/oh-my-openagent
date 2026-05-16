import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { log } from "./logger"

const LEGACY_WORKSPACE_DIR = ".sisyphus"
const WORKSPACE_DIR = ".omo"

export type LegacyWorkspaceMigrationResult = {
  migrated: boolean
  skipped: string[]
}

function copyMissingEntries(legacyPath: string, targetPath: string, targetRoot: string, skipped: string[]): boolean {
  const legacyStat = statSync(legacyPath)

  if (existsSync(targetPath)) {
    if (legacyStat.isDirectory() && statSync(targetPath).isDirectory()) {
      let copiedChild = false
      for (const entry of readdirSync(legacyPath)) {
        copiedChild = copyMissingEntries(join(legacyPath, entry), join(targetPath, entry), targetRoot, skipped) || copiedChild
      }
      return copiedChild
    }

    skipped.push(join(WORKSPACE_DIR, relative(targetRoot, targetPath)))
    return false
  }

  if (legacyStat.isDirectory()) {
    mkdirSync(targetPath, { recursive: true })
    let copiedChild = false
    for (const entry of readdirSync(legacyPath)) {
      copiedChild = copyMissingEntries(join(legacyPath, entry), join(targetPath, entry), targetRoot, skipped) || copiedChild
    }
    return copiedChild
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(legacyPath, targetPath)
  return true
}

export function migrateLegacyWorkspaceDirectory(directory: string): LegacyWorkspaceMigrationResult {
  const legacyDirectory = join(directory, LEGACY_WORKSPACE_DIR)
  if (!existsSync(legacyDirectory)) {
    return { migrated: false, skipped: [] }
  }

  const targetDirectory = join(directory, WORKSPACE_DIR)
  const skipped: string[] = []

  try {
    const migrated = copyMissingEntries(legacyDirectory, targetDirectory, targetDirectory, skipped)
    if (migrated || skipped.length > 0) {
      log("[legacy-workspace-migration] Checked legacy workspace directory", {
        legacyDirectory,
        targetDirectory,
        migrated,
        skipped,
      })
    }
    return { migrated, skipped }
  } catch (error) {
    log("[legacy-workspace-migration] Failed to migrate legacy workspace directory", {
      legacyDirectory,
      targetDirectory,
      error,
    })
    return { migrated: false, skipped }
  }
}
