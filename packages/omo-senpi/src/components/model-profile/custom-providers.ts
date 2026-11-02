import { readModelsJson } from "./models-json"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type DeclaredModelProvider = {
  readonly provider: string
  readonly modelIds: readonly string[]
}

function declaredModelIds(entry: unknown): readonly string[] {
  if (!isRecord(entry) || !Array.isArray(entry["models"])) return []
  return entry["models"].flatMap((model) =>
    isRecord(model) && typeof model["id"] === "string" && model["id"].length > 0 ? [model["id"]] : [],
  )
}

/**
 * Providers the user declared in `<agentDir>/models.json` with models of their own, in declaration
 * order, each with the ids it declares. A builtin profile rung may resolve to one of these after its
 * listed providers (#10485), but only on a declared id: models.json entries are merged into a
 * built-in provider's own catalog, so matching by provider name alone would let that catalog serve
 * ids the user never declared (#9146). An entry that only overrides a built-in provider (`baseUrl`,
 * credentials) declares no models and is not listed.
 */
export function customModelProviders(agentDir: string | undefined): readonly DeclaredModelProvider[] {
  if (agentDir === undefined) return []
  const parsed = readModelsJson(agentDir)
  const providers = isRecord(parsed) ? parsed["providers"] : undefined
  if (!isRecord(providers)) return []
  return Object.entries(providers).flatMap(([provider, entry]) => {
    const modelIds = declaredModelIds(entry)
    return modelIds.length > 0 ? [{ provider, modelIds }] : []
  })
}
