import type { PluginConfigStore } from "../../plugin-config-store"

export function createReloadConfigCommand(configStore: PluginConfigStore) {
  return {
    name: "omo reload-config" as const,
    description: "Reload config from disk (hot-swaps safe fields: model, variant, temperature, fallbacks)",
    execute: async () => {
      const result = await configStore.reload()
      if (result.ok) {
        let msg = "✅ Config reloaded from disk."
        if (result.warnings?.length) {
          msg += `\n⚠️  Warnings:\n${result.warnings.map((w: string) => `  • ${w}`).join("\n")}`
        }
        return msg
      }
      return `❌ Config reload failed:\n${(result.errors ?? []).map((e: string) => `  • ${e}`).join("\n")}`
    },
  }
}
