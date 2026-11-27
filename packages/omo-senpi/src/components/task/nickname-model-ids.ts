import type { OmoConfig, OmoFallbackModels } from "@oh-my-opencode/omo-config-core"

type ModelEntry = string | { readonly model: string }

function addModels(ids: Set<string>, models: OmoFallbackModels | readonly ModelEntry[] | undefined): void {
  if (models === undefined) return
  const entries = typeof models === "string" ? [models] : models
  for (const entry of entries) ids.add(typeof entry === "string" ? entry : entry.model)
}

export function configuredNicknameModelIds(config: OmoConfig): ReadonlySet<string> {
  const ids = new Set<string>()

  for (const entry of Object.values(config.models ?? {})) ids.add(entry.model)
  for (const definition of Object.values(config.agents ?? {})) {
    addModels(ids, definition.model)
    addModels(ids, definition.models)
  }
  for (const definition of Object.values(config.categories ?? {})) {
    addModels(ids, definition.model)
    addModels(ids, definition.models)
    addModels(ids, definition.fallback_models)
  }

  return ids
}
