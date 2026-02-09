import * as p from "@clack/prompts"
import color from "picocolors"
import { getModelsByProvider, getAllCachedModels } from "./models"

export async function selectModelWithCacheLoader(message: string, initialValue?: string): Promise<string | symbol> {
  const providerMap = getModelsByProvider()
  const hasModels = Object.keys(providerMap).length > 0
  
  const options: { value: string; label: string }[] = []

  // Add current value
  if (initialValue) {
    options.push({ value: initialValue, label: `${initialValue} (current)` })
  }

  // Browse by provider (if models available)
  if (hasModels) {
    options.push({ value: "__browse__", label: "📂 Browse cached models by provider..." })
  }

  // Add flat load (fallback)
  options.push({ value: "__load_all__", label: "📄 Load flat list (all models)..." })
  options.push({ value: "__custom__", label: "Custom model..." })
  options.push({ value: "__clear__", label: "Clear selection" })

  const selection = await p.select({
    message,
    options,
    initialValue,
  })

  if (selection === "__browse__") {
    const provider = await p.select({
      message: "Select provider:",
      options: [
        ...Object.keys(providerMap).sort().map(p => ({ value: p, label: p })),
        { value: "__back__", label: color.dim("← Back") }
      ]
    })
    
    if (p.isCancel(provider) || provider === "__back__") return selectModelWithCacheLoader(message, initialValue)

    const models = providerMap[provider as string]
    const model = await p.select({
      message: `Select model for ${provider}:`,
      options: [
        ...models.map(m => ({ value: `${provider}/${m}`, label: m })),
        { value: "__back__", label: color.dim("← Back") }
      ]
    })

    if (p.isCancel(model) || model === "__back__") return selectModelWithCacheLoader(message, initialValue)
    
    return model
  }

  if (selection === "__load_all__") {
    const s = p.spinner()
    s.start("Loading cached models...")
    const allModels = getAllCachedModels()
    s.stop(`Loaded ${allModels.length} models`)

    if (allModels.length === 0) {
      p.log.warn("No models found in cache.")
      return selectModelWithCacheLoader(message, initialValue)
    }

    return p.select({
      message: `${message} (All Cached)`,
      options: [
        ...allModels.map(m => ({ value: m, label: m })),
        { value: "__custom__", label: "Custom model..." },
        { value: "__clear__", label: "Clear selection" },
      ],
      initialValue,
    })
  }

  return selection
}
