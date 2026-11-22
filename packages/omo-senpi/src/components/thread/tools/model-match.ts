import { splitModelDecorators } from "@oh-my-opencode/senpi-task/model-decorators"
import type { ThreadToolResult } from "../contracts"
import { failure } from "./internals"

export type ModelChoice = { readonly provider: string; readonly id: string; readonly name?: string }
type Matched = { readonly kind: "match"; readonly model: ModelChoice; readonly thinkingLevel?: string }

/** An empty model pattern is refused before any catalog is read, on this device or another. */
export function modelPatternFailure(model: string): ThreadToolResult | undefined {
  return model.trim().length === 0
    ? failure("invalid_arguments", "The model pattern is empty.", "Pass a model id or display-name fragment.")
    : undefined
}

/**
 * The one model a catalog's exact `provider/id` names (matchModel's first rung, within `provider` when given): a match
 * no later catalog change can make ambiguous, so a held catalog may decide it; the engine's set_model still confirms it.
 */
export function exactModel(
  catalog: readonly ModelChoice[],
  model: string,
  provider: string | undefined,
): ModelChoice | undefined {
  const pattern = model.trim().toLowerCase()
  const named = catalog.filter(
    (choice) =>
      `${choice.provider}/${choice.id}`.toLowerCase() === pattern &&
      (provider === undefined || choice.provider.toLowerCase() === provider.trim().toLowerCase()),
  )
  return named.length === 1 ? named[0] : undefined
}

/**
 * thread_set_model's one matching rule, for a thread here or on another device: exact provider/id, then exact id, then
 * a case-insensitive fragment of the id or display name, within `provider` when given. A thinking suffix is only
 * interpreted after the literal pattern misses, as in the CLI.
 */
export function matchModel(
  catalog: readonly ModelChoice[],
  model: string,
  provider: string | undefined,
): Matched | ThreadToolResult {
  const reference = model.trim()
  const providerFilter = provider?.trim().toLowerCase()
  const available =
    providerFilter === undefined
      ? catalog
      : catalog.filter((choice) => choice.provider.toLowerCase() === providerFilter)
  const find = (pattern: string) => {
    const byReference = available.filter((choice) => `${choice.provider}/${choice.id}`.toLowerCase() === pattern)
    if (byReference.length > 0) return byReference
    const byId = available.filter((choice) => choice.id.toLowerCase() === pattern)
    if (byId.length > 0) return byId
    return available.filter(
      (choice) => choice.id.toLowerCase().includes(pattern) || choice.name?.toLowerCase().includes(pattern),
    )
  }
  const literal = find(reference.toLowerCase())
  const decorators = literal.length === 0 ? splitModelDecorators(reference, { thinkingOnly: true }) : undefined
  const matches = decorators?.thinkingLevel === undefined ? literal : find(decorators.base.toLowerCase())
  const [first, ...rest] = matches
  if (first === undefined) {
    const availableModels = catalog.slice(0, 20).map((choice) => `${choice.provider}/${choice.id}`)
    const slash = reference.indexOf("/")
    const requestedProvider = slash > 0 ? reference.slice(0, slash) : provider?.trim()
    if (
      requestedProvider &&
      !catalog.some((choice) => choice.provider.toLowerCase() === requestedProvider.toLowerCase())
    ) {
      return failure(
        "model_not_found",
        `Provider "${requestedProvider}" has no available models in the target's catalog.`,
        "Choose a provider from the target's available list or enable the requested provider on the target.",
        {
          reason: "provider_not_configured",
          provider: requestedProvider,
          available_providers: [...new Set(catalog.map((choice) => choice.provider))].sort(),
          available: availableModels,
        },
      )
    }
    return failure(
      "model_not_found",
      `No available model matches "${model}".`,
      "Choose a provider/id from the available list and retry.",
      { available: availableModels },
    )
  }
  if (rest.length > 0)
    return failure(
      "model_ambiguous",
      `Several available models match "${model}".`,
      "Pass an exact provider/id or narrow the pattern with provider.",
      { candidates: matches.slice(0, 10).map((choice) => `${choice.provider}/${choice.id}`) },
    )
  const thinkingLevel = decorators?.thinkingLevel
  return { kind: "match", model: first, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) }
}
