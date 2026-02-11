import * as fs from "node:fs"
import { log } from "../../../shared/logger"
import { PACKAGE_NAME } from "../constants"

function replacePluginEntry(configPath: string, oldEntry: string, newEntry: string): boolean {
  try {
    const content = fs.readFileSync(configPath, "utf-8")

    const pluginMatch = content.match(/"plugin"\s*:\s*\[/)
    if (!pluginMatch || pluginMatch.index === undefined) {
      log(`[auto-update-checker] No "plugin" array found in ${configPath}`)
      return false
    }

    const startIndex = pluginMatch.index + pluginMatch[0].length
    let bracketCount = 1
    let endIndex = startIndex

    for (let i = startIndex; i < content.length && bracketCount > 0; i++) {
      if (content[i] === "[") bracketCount++
      else if (content[i] === "]") bracketCount--
      endIndex = i
    }

    const before = content.slice(0, startIndex)
    const pluginArrayContent = content.slice(startIndex, endIndex)
    const after = content.slice(endIndex)

    const escapedOldEntry = oldEntry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`["']${escapedOldEntry}["']`)

    if (!regex.test(pluginArrayContent)) {
      log(`[auto-update-checker] Entry "${oldEntry}" not found in plugin array of ${configPath}`)
      return false
    }

    const updatedPluginArray = pluginArrayContent.replace(regex, `"${newEntry}"`)
    const updatedContent = before + updatedPluginArray + after

    if (updatedContent === content) {
      log(`[auto-update-checker] No changes made to ${configPath}`)
      return false
    }

    fs.writeFileSync(configPath, updatedContent, "utf-8")
    log(`[auto-update-checker] Updated ${configPath}: ${oldEntry} → ${newEntry}`)
    return true
  } catch (err) {
    log(`[auto-update-checker] Failed to update config file ${configPath}:`, err)
    return false
  }
}

export function updatePinnedVersion(configPath: string, oldEntry: string, newVersion: string): boolean {
  const newEntry = `${PACKAGE_NAME}@${newVersion}`
  return replacePluginEntry(configPath, oldEntry, newEntry)
}

export function revertPinnedVersion(configPath: string, failedVersion: string, originalEntry: string): boolean {
  const failedEntry = `${PACKAGE_NAME}@${failedVersion}`
  return replacePluginEntry(configPath, failedEntry, originalEntry)
}
