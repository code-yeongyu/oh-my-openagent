import { homedir } from "os"
import { join } from "path"

export function getPluginsBaseDir(): string {
  if (process.env.CLAUDE_PLUGINS_HOME) {
    return process.env.CLAUDE_PLUGINS_HOME
  }
  return join(homedir(), ".claude", "plugins")
}

export function getInstalledPluginsPath(pluginsBaseDir?: string): string {
  return join(pluginsBaseDir ?? getPluginsBaseDir(), "installed_plugins.json")
}

export function getClaudeSettingsPath(): string {
  if (process.env.CLAUDE_SETTINGS_PATH) {
    return process.env.CLAUDE_SETTINGS_PATH
  }
  return join(homedir(), ".claude", "settings.json")
}
