import { existsSync, copyFileSync, renameSync } from "node:fs"
import { join, dirname, basename } from "node:path"

import { log } from "./logger"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "./plugin-identity"

function buildCanonicalPath(legacyPath: string): string {
  const dir = dirname(legacyPath)
  const ext = basename(legacyPath).includes(".jsonc") ? ".jsonc" : ".json"
  return join(dir, `${CONFIG_BASENAME}${ext}`)
}

export function migrateLegacyConfigFile(legacyPath: string): boolean {
  if (!existsSync(legacyPath)) return false
  if (!basename(legacyPath).startsWith(LEGACY_CONFIG_BASENAME)) return false

  const canonicalPath = buildCanonicalPath(legacyPath)
  if (existsSync(canonicalPath)) return false

  try {
    copyFileSync(legacyPath, canonicalPath)
    log("[migrateLegacyConfigFile] Copied legacy config to canonical path", {
      from: legacyPath,
      to: canonicalPath,
    })
    return true
  } catch (error) {
    log("[migrateLegacyConfigFile] Failed to copy legacy config file", { legacyPath, error })
    return false
  }
}
