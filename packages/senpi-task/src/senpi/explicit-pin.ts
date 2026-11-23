import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { senpiBarrel } from "../lazy/senpi-barrel"
import { SENPI_SERVICE_TIERS, SENPI_THINKING_LEVELS, splitModelDecorators } from "./model-decorators"

export { splitModelDecorators } from "./model-decorators"

// The concrete ModelRuntime a live senpi ModelRegistry carries; unit fakes satisfy it with the
// same barrel class, so no structural re-declaration can drift from the engine's.
export type ExplicitPinRuntime = NonNullable<CreateAgentSessionOptions["modelRuntime"]>

export type ResolvedExplicitPin = {
  readonly kind: "resolved"
  readonly provider: string
  readonly modelId: string
  readonly canonical: string
  readonly thinkingLevel?: string
}

export type ExplicitPinFailure = {
  readonly kind: "invalid_target" | "model_unavailable"
  readonly message: string
}

export type ExplicitPinResolution = ResolvedExplicitPin | ExplicitPinFailure

/**
 * Parse an explicit task model pin ONCE with senpi's own resolver, so a pin and `senpi --model`
 * mean exactly the same string (fuzzy ids, colon ids, `:level`/`:tier` decorators). The result is
 * canonical: a resolved pin carries the catalog `provider/model_id` plus the parsed thinking
 * level. Two refusal shapes: `invalid_target` for a pin no amount of registry could ever honour
 * (empty id, an unknown suffix on a real id, an ambiguous bare id), and `model_unavailable` for a
 * well-formed pin the live catalog does not serve. `resolveCliModel` fabricates a custom id for a
 * catalog miss instead of erroring; a task pin must be an exact catalog hit, so the fabricated
 * shape is classified here instead of trusted.
 */
export function resolveExplicitTaskPin(pin: string, modelRuntime: ExplicitPinRuntime): ExplicitPinResolution {
  const trimmed = pin.trim()
  const slash = trimmed.indexOf("/")
  const idStem = slash < 0 ? trimmed : splitModelDecorators(trimmed.slice(slash + 1)).base
  if (trimmed === "" || slash === 0 || (slash >= 0 && (idStem === "" || idStem.startsWith(":")))) {
    return {
      kind: "invalid_target",
      message: `The task model pin "${pin}" is malformed: use provider/model with an optional :thinking-level suffix.`,
    }
  }
  const { resolveCliModel } = senpiBarrel()
  const result = resolveCliModel({ cliModel: trimmed, modelRuntime })
  if (result.error !== undefined) {
    return { kind: "model_unavailable", message: `The task model pin "${trimmed}" did not resolve: ${result.error}` }
  }
  // A service tier has no task-plan carrier (tiers are inherited from the parent, not pinned per
  // child): accepting and dropping it would silently run the child at a tier nobody asked for.
  if (result.serviceTier !== undefined) {
    return {
      kind: "invalid_target",
      message: `The task model pin "${trimmed}" carries service tier "${result.serviceTier}", which a task pin cannot express; drop the suffix or set the tier on the parent.`,
    }
  }
  const model = result.model
  if (model !== undefined && isCatalogModel(modelRuntime, model.provider, model.id)) {
    return {
      kind: "resolved",
      provider: model.provider,
      modelId: model.id,
      canonical: `${model.provider}/${model.id}`,
      ...(result.thinkingLevel === undefined ? {} : { thinkingLevel: result.thinkingLevel }),
    }
  }
  const invalidLevel = invalidLevelMessage(trimmed, modelRuntime)
  if (invalidLevel !== undefined) return { kind: "invalid_target", message: invalidLevel }
  return {
    kind: "model_unavailable",
    message: `The task model pin "${trimmed}" did not resolve to a model in the live registry.`,
  }
}

function isCatalogModel(modelRuntime: ExplicitPinRuntime, provider: string, modelId: string): boolean {
  return [...modelRuntime.getModels()].some((entry) => entry.provider === provider && entry.id === modelId)
}

function invalidLevelMessage(pin: string, modelRuntime: ExplicitPinRuntime): string | undefined {
  const slash = pin.indexOf("/")
  if (slash < 0) return undefined
  const rest = pin.slice(slash + 1)
  const colon = rest.lastIndexOf(":")
  if (colon <= 0) return undefined
  const suffix = rest.slice(colon + 1)
  if (SENPI_THINKING_LEVELS.has(suffix) || SENPI_SERVICE_TIERS.has(suffix)) return undefined
  if (!isCatalogModel(modelRuntime, pin.slice(0, slash), rest.slice(0, colon))) return undefined
  return `The task model pin "${pin}" is invalid: "${suffix}" is not a thinking level or service tier.`
}

export type SettingsDefaultRoute = {
  readonly provider: string
  readonly modelId: string
}

/**
 * The settings default a pin-less child would start on, named in a `model_unavailable` error so
 * the caller sees the route the failure just protected it from. Best-effort: an unreadable or
 * unset default omits the suffix rather than breaking the failure it decorates.
 */
export function readSettingsDefaultRoute(input: {
  readonly cwd: string
  readonly agentDir: string
}): SettingsDefaultRoute | undefined {
  try {
    const { SettingsManager } = senpiBarrel()
    const settings = SettingsManager.create(input.cwd, input.agentDir)
    const provider = settings.getDefaultProvider()
    const modelId = settings.getDefaultModel()
    if (typeof provider !== "string" || typeof modelId !== "string" || provider.length === 0 || modelId.length === 0)
      return undefined
    return { provider, modelId }
  } catch {
    // no-excuse-ok: catch - a best-effort message detail never breaks the failure it describes.
    return undefined
  }
}
