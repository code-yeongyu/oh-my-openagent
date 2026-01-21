import type { ModelChain } from "./types"

export function resolveModelChain(modelConfig?: string | string[]): ModelChain | null {
  if (!modelConfig) return null

  let models: string[] = []

  if (Array.isArray(modelConfig)) {
    models = modelConfig
  } else if (typeof modelConfig === "string") {
    if (modelConfig.includes("|")) {
      models = modelConfig.split("|").map(m => m.trim()).filter(Boolean)
    } else {
      models = [modelConfig]
    }
  }

  if (models.length === 0) return null

  return {
    primary: models[0],
    fallbacks: models.slice(1)
  }
}
