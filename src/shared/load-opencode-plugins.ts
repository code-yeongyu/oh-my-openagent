import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { parseJsoncSafe } from "./jsonc-parser"

interface OpencodeConfig {
  plugin?: (string | [string, ...unknown[]])[]
}

function getWindowsAppdataDir(): string | null {
  return process.env.APPDATA || null
}

function getConfigPaths(directory: string): string[] {
  const crossPlatformDir = path.join(os.homedir(), ".config")
  const paths = [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(crossPlatformDir, "opencode", "opencode.json"),
    path.join(crossPlatformDir, "opencode", "opencode.jsonc"),
  ]

  if (process.platform === "win32") {
    const appdataDir = getWindowsAppdataDir()
    if (appdataDir) {
      paths.push(path.join(appdataDir, "opencode", "opencode.json"))
      paths.push(path.join(appdataDir, "opencode", "opencode.jsonc"))
    }
  }

  return paths
}

export function loadOpencodePlugins(directory: string): string[] {
  const pluginEntries: string[] = []
  const seenPluginEntries = new Set<string>()

  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue

      const content = fs.readFileSync(configPath, "utf-8")
      const result = parseJsoncSafe<OpencodeConfig>(content)
      const plugins = result.data?.plugin ?? []

      for (const rawPlugin of plugins) {
        const plugin = typeof rawPlugin === "string" ? rawPlugin : Array.isArray(rawPlugin) ? rawPlugin[0] : null
        if (typeof plugin !== "string") continue
        if (seenPluginEntries.has(plugin)) continue
        seenPluginEntries.add(plugin)
        pluginEntries.push(plugin)
      }
    } catch {
      continue
    }
  }

  return pluginEntries
}
