import type { PluginConfigStore } from "../../plugin-config-store"

export function createConfigSetCommand(configStore: PluginConfigStore) {
  return {
    name: "omo config set" as const,
    description: "Set a config value at dot-separated path (hot-swap safe paths only)",
    execute: async (_args: string[]) => {
      if (_args.length < 2) return "Usage: /omo config set <path> <value>"
      const path = _args[0]
      const value = _args.slice(1).join(" ")
      try {
        await configStore.setValue(path, value)
        return `✅ Set ${path} = ${value}`
      } catch (e) {
        return `❌ ${String(e)}`
      }
    },
  }
}
