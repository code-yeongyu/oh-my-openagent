import {
  NoMatchingVariantError,
  type ResolveVariantInput,
  type VariantDefinition,
  type VariantFallback,
} from "./types"

function isVariantFallback(definition: VariantDefinition): definition is VariantFallback {
  return "fallback" in definition && definition.fallback === true
}

export function resolveVariant(input: ResolveVariantInput): string {
  const entries = Object.entries(input.variants)
  const testInput = {
    ...(input.modelID === undefined ? {} : { modelID: input.modelID }),
    ...(input.agentName === undefined ? {} : { agentName: input.agentName }),
  }

  for (const [variantKey, definition] of entries) {
    if (isVariantFallback(definition)) continue
    if (definition.test(testInput)) return variantKey
  }

  const fallbackEntry = entries.find(([, definition]) => isVariantFallback(definition))
  if (fallbackEntry !== undefined) return fallbackEntry[0]

  const variantKeys = entries.map(([variantKey]) => variantKey).join(", ")
  throw new NoMatchingVariantError(`No matching prompt variant found among: ${variantKeys}`)
}
