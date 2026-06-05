import type { ModelPreset, ModelPresetMatch } from "./types"

/**
 * Strip provider prefix from model name.
 * "llmgateway/deepseek-v4-pro" → "deepseek-v4-pro"
 * "opencode-go/mimo-v2.5-pro" → "mimo-v2.5-pro"
 */
function stripProvider(model: string): string {
  return model.includes("/") ? model.split("/").pop() ?? model : model
}

/**
 * Score how well a preset matches a model.
 * Exact match = highest priority. Substring = fallback.
 */
function matchScore(presetModel: string, actualModel: string): number {
  const p = presetModel.toLowerCase()
  const a = actualModel.toLowerCase()
  if (p === a) return 100  // exact match
  if (a === p) return 100  // reverse exact
  if (a.startsWith(p)) return 80  // "deepseek-v4-pro" starts with "deepseek-v4"
  if (a.includes(p)) return 60   // contains
  if (p.includes(a)) return 40   // reverse contains
  return 0
}

/**
 * Resolve the best ModelPreset for a given agent + model combination.
 * Returns the highest-scoring match, or null if no preset matches.
 */
export function resolveModelPreset(
  agent: string,
  model: string,
  presets: ModelPreset[],
): ModelPreset | null {
  const stripped = stripProvider(model)
  const matches: ModelPresetMatch[] = []

  for (const preset of presets) {
    if (preset.agent !== agent && preset.agent !== "*") continue

    const models = Array.isArray(preset.model) ? preset.model : [preset.model]
    for (const pm of models) {
      const score = matchScore(pm, stripped)
      if (score > 0) {
        matches.push({ preset, score: score + (preset.priority ?? 0) })
      }
    }
  }

  if (matches.length === 0) return null

  // Sort by score descending, take highest
  matches.sort((a, b) => b.score - a.score)
  return matches[0].preset
}

/**
 * Check if any preset matches the given agent + model (boolean).
 */
export function hasModelPreset(
  agent: string,
  model: string,
  presets: ModelPreset[],
): boolean {
  return resolveModelPreset(agent, model, presets) !== null
}
