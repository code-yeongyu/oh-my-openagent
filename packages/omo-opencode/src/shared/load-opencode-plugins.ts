import * as fs from "node:fs"
import * as path from "node:path"

import { parseJsoncSafe } from "./jsonc-parser"
import { getOpenCodeConfigDirs } from "./opencode-config-dir"

interface OpencodeConfig {
  plugin?: (string | [string, ...unknown[]])[]
}

const opencodePluginsCache = new Map<string, string[]>()

function getConfigPaths(directory: string): string[] {
  const configDirs = getOpenCodeConfigDirs({ binary: "opencode" })
  return [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    ...configDirs.flatMap((dir) => [
      path.join(dir, "opencode.json"),
      path.join(dir, "opencode.jsonc"),
    ]),
  ]
}

export function loadOpencodePlugins(directory: string): string[] {
  const cachedPluginEntries = opencodePluginsCache.get(directory)
  if (cachedPluginEntries) {
    return cachedPluginEntries
  }

  const pluginEntries: string[] = []
  const seenPluginEntries = new Set<string>()

  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue

      const content = fs.readFileSync(configPath, "utf-8")
      const result = parseJsoncSafe<OpencodeConfig>(content)
      const plugins = result.data?.plugin ?? []

      for (const plugin of plugins) {
        const entry = typeof plugin === "string" ? plugin : Array.isArray(plugin) ? plugin[0] : null
        if (typeof entry !== "string") continue
        if (seenPluginEntries.has(entry)) continue
        seenPluginEntries.add(entry)
        pluginEntries.push(entry)
      }
    } catch (error) {
      if (error instanceof Error) {
        continue
      }

      continue
    }
  }

  opencodePluginsCache.set(directory, pluginEntries)
  return pluginEntries
}

export function clearOpencodePluginsCache(): void {
  opencodePluginsCache.clear()
}
