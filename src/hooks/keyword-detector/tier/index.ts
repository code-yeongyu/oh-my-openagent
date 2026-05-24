import type { PluginConfigStore } from "../../../features/plugin-config-store"

const TIER_PATTERNS = {
  cheap: ["cheap", "barato", "low cost", "economico", "rapido", "fast", "flash", "free"],
  expensive: ["expensive", "caro", "high quality", "premium", "deep", "ultrabrain", "gpt"],
} as const

export function detectTierIntent(text: string): "cheap" | "expensive" | null {
  const lower = text.toLowerCase()
  for (const pattern of TIER_PATTERNS.cheap) {
    if (lower.includes(pattern)) return "cheap"
  }
  for (const pattern of TIER_PATTERNS.expensive) {
    if (lower.includes(pattern)) return "expensive"
  }
  return null
}

export async function handleTierKeyword(
  text: string,
  configStore: PluginConfigStore,
): Promise<string | null> {
  const intent = detectTierIntent(text)
  if (!intent) return null

  const current = configStore.get()
  if (!current.agents) return null

  if (intent === "cheap") {
    for (const [name, agent] of Object.entries(current.agents)) {
      if (agent.category === "quick" || agent.category === "unspecified-low") continue
      try {
        await configStore.setValue(`agents.${name}.model`, "opencode/deepseek-v4-flash-free")
      } catch { /* skip agents without safe path */ }
    }
    return `🌊 Switched to CHEAP tier: all agents now use fast/free models`
  } else {
    return null // expensive tier is manual via /omo config set
  }
}
