import type { OmoaState } from "../state/omoa-state-schema"
import { extractProvider } from "./resolver"

export interface ValidationWarning {
  type: "disabled-primary" | "same-provider-fallback" | "banned-model" | "deprecated-model" | "free-only-violation" | "missing-fallback" | "no-ranking" | "config-invalid"
  target: string
  message: string
  severity: "error" | "warning" | "info"
}

export interface ValidationResult {
  valid: boolean
  warnings: ValidationWarning[]
}

export function validateConfig(
  agents: Record<string, { model?: string; fallback_models?: unknown }>,
  categories: Record<string, { model?: string; fallback_models?: unknown }>,
  state: OmoaState,
): ValidationResult {
  const warnings: ValidationWarning[] = []

  for (const [name, agent] of Object.entries(agents)) {
    if (!agent.model) continue

    const provider = extractProvider(agent.model)

    if (state.banned_models.includes(agent.model)) {
      warnings.push({ type: "banned-model", target: name, message: `Agent "${name}" uses banned model: ${agent.model}`, severity: "error" })
    }

    if (state.deprecated_models.includes(agent.model)) {
      warnings.push({ type: "deprecated-model", target: name, message: `Agent "${name}" uses deprecated model: ${agent.model}`, severity: "warning" })
    }

    const providerState = state.providers[provider]
    if (providerState && !providerState.enabled) {
      warnings.push({ type: "disabled-primary", target: name, message: `Agent "${name}" primary uses disabled provider: ${provider}`, severity: "error" })
    }

    if (state.providers[provider]?.free_only && !agent.model.endsWith("-free")) {
      warnings.push({ type: "free-only-violation", target: name, message: `Agent "${name}" uses non-free model on free-only provider: ${agent.model}`, severity: "error" })
    }

    const fallbacks = normalizeFallbacks(agent.fallback_models)
    const primaryProvider = provider
    for (const fb of fallbacks) {
      const fbProvider = extractProvider(fb)
      if (fbProvider === primaryProvider) {
        warnings.push({ type: "same-provider-fallback", target: name, message: `Agent "${name}" fallback "${fb}" is same provider as primary`, severity: "warning" })
      }
      if (state.banned_models.includes(fb)) {
        warnings.push({ type: "banned-model", target: name, message: `Agent "${name}" fallback uses banned model: ${fb}`, severity: "error" })
      }
    }

    if (fallbacks.length === 0 && agent.model) {
      warnings.push({ type: "missing-fallback", target: name, message: `Agent "${name}" has primary model but no fallback`, severity: "info" })
    }
  }

  for (const [name, category] of Object.entries(categories)) {
    if (!category.model) continue

    const provider = extractProvider(category.model)
    if (state.banned_models.includes(category.model)) {
      warnings.push({ type: "banned-model", target: `category:${name}`, message: `Category "${name}" uses banned model: ${category.model}`, severity: "error" })
    }
    const catProviderState = state.providers[provider]
    if (catProviderState && !catProviderState.enabled) {
      warnings.push({ type: "disabled-primary", target: `category:${name}`, message: `Category "${name}" primary uses disabled provider: ${provider}`, severity: "error" })
    }

    const fallbacks = normalizeFallbacks(category.fallback_models)
    const primaryProvider = provider
    for (const fb of fallbacks) {
      if (extractProvider(fb) === primaryProvider) {
        warnings.push({ type: "same-provider-fallback", target: `category:${name}`, message: `Category "${name}" fallback "${fb}" is same provider as primary`, severity: "warning" })
      }
    }
  }

  const hasErrors = warnings.some((w) => w.severity === "error")
  return { valid: !hasErrors, warnings }
}

function normalizeFallbacks(fallbacks: unknown): string[] {
  if (!fallbacks) return []
  if (typeof fallbacks === "string") return [fallbacks]
  if (Array.isArray(fallbacks)) return fallbacks.map((f) => typeof f === "string" ? f : (f as { model?: string })?.model ?? String(f))
  return []
}
