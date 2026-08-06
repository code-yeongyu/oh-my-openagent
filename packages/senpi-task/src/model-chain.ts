import { transformModelForProvider, type DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

import type { ResolvedModelRecord, ResolvedModelSource } from "./state"

export type ModelChainCandidate = {
  readonly model: string
  readonly variant?: string
  readonly reasoningEffort?: string
}

type BuildModelChainOptions = {
  readonly candidates: readonly ModelChainCandidate[]
  readonly selectedModel: string
  readonly availableModels?: ReadonlySet<string>
  readonly source: ResolvedModelSource
}

export type RuntimeModelChain = {
  readonly requested_model?: ResolvedModelRecord
  readonly fallback_models?: readonly ResolvedModelRecord[]
}

export function buildRuntimeModelChain(options: BuildModelChainOptions): RuntimeModelChain {
  const candidates = deduplicateCandidates(options.candidates)
  const requestedModel = toResolvedModelRecord(candidates[0], options.source)
  if (requestedModel === undefined) return {}

  const selectedIndex = candidates.findIndex((candidate) => candidate.model === options.selectedModel)
  const fallbackModels = selectedIndex === -1
    ? []
    : candidates
      .slice(selectedIndex + 1)
      .filter((candidate) =>
        options.availableModels === undefined || options.availableModels.has(candidate.model)
      )
      .map((candidate) => toResolvedModelRecord(candidate, options.source))
      .filter((candidate): candidate is ResolvedModelRecord => candidate !== undefined)

  return {
    requested_model: requestedModel,
    ...(fallbackModels.length > 0 ? { fallback_models: fallbackModels } : {}),
  }
}

export type ChainRungCandidateOptions = {
  readonly chain: readonly DelegateFallbackEntry[]
  readonly selectedModel: string
  readonly selectedRungEntry?: DelegateFallbackEntry
  readonly availableModels: ReadonlySet<string>
}

// Chain-derived runtime candidates for a resolved selection: the selected rung's concrete model
// first (so buildRuntimeModelChain can locate it), then the remaining rungs after it, each resolved
// to the first available provider with the provider-specific model-id transform applied. Rungs with
// no available provider are skipped. Returns [] when the selected model cannot be located in the
// chain (e.g. a user-forced model), leaving user-configured chains untouched.
export function chainRungCandidates(options: ChainRungCandidateOptions): readonly ModelChainCandidate[] {
  const selectedIndex = locateSelectedRung(options)
  if (selectedIndex === -1) return []

  const rungs: ModelChainCandidate[] = [{ model: options.selectedModel }]
  for (const entry of options.chain.slice(selectedIndex + 1)) {
    for (const provider of entry.providers) {
      const concrete = `${provider}/${transformModelForProvider(provider, entry.model)}`
      if (!options.availableModels.has(concrete)) continue
      rungs.push({
        model: concrete,
        ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
      })
      break
    }
  }
  return rungs
}

function locateSelectedRung(options: ChainRungCandidateOptions): number {
  const { chain, selectedModel, selectedRungEntry } = options
  if (selectedRungEntry !== undefined) {
    const byIdentity = chain.indexOf(selectedRungEntry)
    if (byIdentity !== -1) return byIdentity
    const byShape = chain.findIndex((entry) =>
      entry.model === selectedRungEntry.model
      && entry.variant === selectedRungEntry.variant
      && entry.providers.length === selectedRungEntry.providers.length
      && entry.providers.every((provider, index) => provider === selectedRungEntry.providers[index])
    )
    if (byShape !== -1) return byShape
  }
  return chain.findIndex((entry) =>
    entry.providers.some(
      (provider) => `${provider}/${transformModelForProvider(provider, entry.model)}` === selectedModel,
    )
  )
}

function deduplicateCandidates(candidates: readonly ModelChainCandidate[]): readonly ModelChainCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.model)) return false
    seen.add(candidate.model)
    return true
  })
}

function toResolvedModelRecord(
  candidate: ModelChainCandidate | undefined,
  source: ResolvedModelSource,
): ResolvedModelRecord | undefined {
  if (candidate === undefined) return undefined
  const separatorIndex = candidate.model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === candidate.model.length - 1) return undefined

  const provider = candidate.model.slice(0, separatorIndex)
  const modelId = candidate.model.slice(separatorIndex + 1)
  return {
    source,
    provider,
    model_id: modelId,
    display: `${provider}/${modelId}`,
    ...(candidate.variant !== undefined ? { variant: candidate.variant } : {}),
    ...(candidate.reasoningEffort !== undefined
      ? { reasoning_effort: candidate.reasoningEffort }
      : {}),
  }
}
