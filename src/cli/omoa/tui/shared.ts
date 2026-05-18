import { existsSync, readFileSync } from "node:fs"
import { parseJsonc } from "../../../shared/jsonc-parser"
import { getConfigContext } from "../../config-manager"
import type { OhMyOpenCodeConfig } from "../../../config/schema"
import { extractProvider } from "../engine/resolver"

type MutableConfig = Partial<OhMyOpenCodeConfig> & Record<string, unknown>

export function loadRuntimeConfig(): MutableConfig | null {
  const { paths } = getConfigContext()
  if (!existsSync(paths.omoConfig)) return {}
  try {
    return parseJsonc<MutableConfig>(readFileSync(paths.omoConfig, "utf-8")) ?? {}
  } catch {
    return null
  }
}

export function loadTypedRuntimeConfig(): OhMyOpenCodeConfig | null {
  const { paths } = getConfigContext()
  if (!existsSync(paths.omoConfig)) return null
  try {
    return parseJsonc<OhMyOpenCodeConfig>(readFileSync(paths.omoConfig, "utf-8"))
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function countProviderUsage(config: any): Map<string, { primary: number; fallback: number }> {
  const counts = new Map<string, { primary: number; fallback: number }>()

  for (const agent of Object.values(config.agents ?? {})) {
    const a = agent as { model?: string; fallback_models?: unknown }
    if (a.model) {
      const provider = extractProvider(a.model)
      const entry = counts.get(provider) ?? { primary: 0, fallback: 0 }
      entry.primary++
      counts.set(provider, entry)
    }
    const fallbacks = normalizeFallbacks(a.fallback_models)
    for (const fb of fallbacks) {
      const provider = extractProvider(fb)
      const entry = counts.get(provider) ?? { primary: 0, fallback: 0 }
      entry.fallback++
      counts.set(provider, entry)
    }
  }

  for (const cat of Object.values(config.categories ?? {})) {
    const c = cat as { model?: string; fallback_models?: unknown }
    if (c.model) {
      const provider = extractProvider(c.model)
      const entry = counts.get(provider) ?? { primary: 0, fallback: 0 }
      entry.primary++
      counts.set(provider, entry)
    }
  }

  return counts
}

export function normalizeFallbacks(fallbacks: unknown): string[] {
  if (!fallbacks) return []
  if (typeof fallbacks === "string") return [fallbacks]
  if (Array.isArray(fallbacks)) return fallbacks.map((f) => typeof f === "string" ? f : (f as { model?: string })?.model ?? String(f))
  return []
}
