import { existsSync, readFileSync } from "fs"
import { log } from "../../shared/logger"
import type { HooksConfig, LoadedPlugin } from "./types"
import { resolvePluginPaths } from "./plugin-path-resolver"

export function loadPluginHooksConfigs(plugins: LoadedPlugin[]): HooksConfig[] {
  const configs: HooksConfig[] = []

  for (const plugin of plugins) {
    if (!plugin.hooksPath || !existsSync(plugin.hooksPath)) continue

    try {
      const content = readFileSync(plugin.hooksPath, "utf-8")
      let config = JSON.parse(content) as HooksConfig

      config = resolvePluginPaths(config, plugin.installPath)

      configs.push(config)
      log(`Loaded plugin hooks config from ${plugin.name}`, { path: plugin.hooksPath })
    } catch (error) {
      log(`Failed to load plugin hooks config: ${plugin.hooksPath}`, error)
    }
  }

  return configs
}
