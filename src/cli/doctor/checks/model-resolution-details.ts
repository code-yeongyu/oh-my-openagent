import { join } from "node:path"

import { getOpenCodeCacheDir } from "../../../shared"
import type { AvailableModelsInfo, ModelResolutionInfo, OmoConfig } from "./model-resolution-types"
import { formatModelWithVariant, getCategoryEffectiveVariant, getEffectiveVariant } from "./model-resolution-variant"

export function buildModelResolutionDetails(options: {
  info: ModelResolutionInfo
  available: AvailableModelsInfo
  config: OmoConfig
}): string[] {
  const details: string[] = []
  const cacheFile = join(getOpenCodeCacheDir(), "models.json")

  details.push("═══ Available Models (from cache) ═══")
  details.push("")
  if (options.available.cacheExists) {
    details.push(`  Providers in cache: ${options.available.providers.length}`)
    details.push(
      `  Sample: ${options.available.providers.slice(0, 6).join(", ")}${options.available.providers.length > 6 ? "..." : ""}`
    )
    details.push(`  Total models: ${options.available.modelCount}`)
    details.push(`  Cache: ${cacheFile}`)
    details.push(`  ℹ Runtime: only connected providers used`)
    details.push(`  Refresh: opencode models --refresh`)
  } else {
    details.push("  ⚠ Cache not found. Run 'opencode' to populate.")
  }
  details.push("")

  details.push("═══ Configured Models ═══")
  details.push("")
  details.push("Agents:")
  for (const agent of options.info.agents) {
    const marker = agent.userOverride ? "●" : "○"
    const display = formatModelWithVariant(
      agent.effectiveModel,
      getEffectiveVariant(agent.name, agent.requirement, options.config)
    )
    details.push(`  ${marker} ${agent.name}: ${display}`)
  }
  details.push("")
  details.push("Categories:")
  for (const category of options.info.categories) {
    const marker = category.userOverride ? "●" : "○"
    const display = formatModelWithVariant(
      category.effectiveModel,
      getCategoryEffectiveVariant(category.name, category.requirement, options.config)
    )
    details.push(`  ${marker} ${category.name}: ${display}`)
  }
  details.push("")
  details.push("● = user override, ○ = provider fallback")

  return details
}
