import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import { applyEdits, modify } from "jsonc-parser"

import { parseJsoncSafe } from "./jsonc-parser"
import { log } from "./logger"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"
import { isCanonicalEntry, isLegacyEntry, toCanonicalEntry } from "./plugin-entry-migrator"

interface OpenCodeConfig {
  plugin?: string[]
}

function normalizePluginEntries(entries: string[]): string[] {
  const hasCanonical = entries.some(isCanonicalEntry)

  if (hasCanonical) {
    return entries.filter((entry) => !isLegacyEntry(entry))
  }

  return entries.map((entry) => (isLegacyEntry(entry) ? toCanonicalEntry(entry) : entry))
}

function updateJsoncPluginArray(content: string, pluginEntries: string[]): string | null {
  const edits = modify(content, ["plugin"], pluginEntries, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    },
    getInsertionIndex: () => 0,
  })

  if (edits.length === 0) return null
  return applyEdits(content, edits)
}

export function migrateLegacyPluginEntry(configPath: string): boolean {
  if (!existsSync(configPath)) return false

  try {
    const content = readFileSync(configPath, "utf-8")
    if (!content.includes(LEGACY_PLUGIN_NAME)) return false

    const parseResult = parseJsoncSafe<OpenCodeConfig>(content)
    const pluginEntries = parseResult.data?.plugin
    if (!pluginEntries || !pluginEntries.some(isLegacyEntry)) return false

    const updatedPluginEntries = normalizePluginEntries(pluginEntries)
    const updated = configPath.endsWith(".jsonc")
      ? updateJsoncPluginArray(content, updatedPluginEntries)
      : JSON.stringify({ ...(parseResult.data as OpenCodeConfig), plugin: updatedPluginEntries }, null, 2) + "\n"
    if (!updated || updated === content) return false

    const tempPath = `${configPath}.tmp`
    writeFileSync(tempPath, updated, "utf-8")
    const tempFileDescriptor = openSync(tempPath, "r")
    try {
      fsyncSync(tempFileDescriptor)
    } finally {
      closeSync(tempFileDescriptor)
    }

    renameSync(tempPath, configPath)
    log("[migrateLegacyPluginEntry] Auto-migrated opencode.json plugin entry", {
      configPath,
      from: LEGACY_PLUGIN_NAME,
      to: PLUGIN_NAME,
    })
    return true
  } catch (error) {
    log("[migrateLegacyPluginEntry] Failed to migrate opencode.json", { configPath, error })
    return false
  }
}
