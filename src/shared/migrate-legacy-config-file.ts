import { existsSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join, dirname, basename } from "node:path"

import { log } from "./logger"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "./plugin-identity"
import { writeFileAtomically } from "./write-file-atomically"

function buildCanonicalPath(legacyPath: string): string {
  const dir = dirname(legacyPath)
  const ext = basename(legacyPath).includes(".jsonc") ? ".jsonc" : ".json"
  return join(dir, `${CONFIG_BASENAME}${ext}`)
}

function archiveLegacyConfigFile(legacyPath: string): boolean {
  const backupPath = `${legacyPath}.bak`

  try {
    renameSync(legacyPath, backupPath)
    log("[migrateLegacyConfigFile] Legacy config was migrated and renamed to backup. Update the canonical file only.", {
      legacyPath,
      backupPath,
    })
    return true
  } catch (renameError) {
    try {
      rmSync(legacyPath)
      log("[migrateLegacyConfigFile] Legacy config was migrated and removed after backup rename failed. Update the canonical file only.", {
        legacyPath,
        backupPath,
        renameError,
      })
      return true
    } catch (removeError) {
      log("[migrateLegacyConfigFile] WARNING: canonical config was written but the legacy file still exists and will be ignored. Remove or rename it manually.", {
        legacyPath,
        backupPath,
        renameError,
        removeError,
      })
      return false
    }
  }
}

export function migrateLegacyConfigFile(legacyPath: string): boolean {
  if (!existsSync(legacyPath)) return false
  if (!basename(legacyPath).startsWith(LEGACY_CONFIG_BASENAME)) return false

  const canonicalPath = buildCanonicalPath(legacyPath)
  if (existsSync(canonicalPath)) return false

  try {
    const content = readFileSync(legacyPath, "utf-8")
    writeFileAtomically(canonicalPath, content)
    const archivedLegacyConfig = archiveLegacyConfigFile(legacyPath)
    log("[migrateLegacyConfigFile] Migrated legacy config to canonical path", {
      from: legacyPath,
      to: canonicalPath,
      archivedLegacyConfig,
    })
    return archivedLegacyConfig
  } catch (error) {
    log("[migrateLegacyConfigFile] Failed to migrate legacy config file", { legacyPath, error })
    return false
  }
}
