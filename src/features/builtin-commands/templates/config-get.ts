import type { PluginConfigStore } from "../../plugin-config-store"

export function createConfigGetCommand(configStore: PluginConfigStore) {
  return {
    name: "omo config get" as const,
    description: "Show a config value at dot-separated path (e.g. 'agents.sisyphus.model')",
    execute: async (_args: string[]) => {
      const path = _args.join(".")
      if (!path) return "Usage: /omo config get <path> (e.g. 'agents.sisyphus.model')"
      const value = configStore.getValue(path)
      if (value === undefined) return `❌ No value at '${path}'`
      return `📋 ${path} = ${JSON.stringify(value, null, 2)}`
    },
  }
}
