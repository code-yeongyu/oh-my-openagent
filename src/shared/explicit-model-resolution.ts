import { resolveModelIDAlias } from "./model-capability-aliases"
import { detectHeuristicModelFamily } from "./model-capability-heuristics"
import { normalizeModelFormat } from "./model-format-normalizer"
import { normalizeModel, normalizeModelID } from "./model-normalization"
import { transformModelForProvider } from "./provider-model-id-transform"

function canonicalizeExplicitModelID(modelID: string): string {
  const resolution = resolveModelIDAlias(modelID)
  return resolution.source === "canonical"
    ? modelID.trim()
    : resolution.canonicalModelID
}

function isFloatingFamilyAlias(modelID: string): boolean {
  const normalizedModelID = normalizeModelID(modelID.trim().toLowerCase())
  const family = detectHeuristicModelFamily(normalizedModelID)?.family
  return family !== undefined && normalizedModelID === family
}

function filterCandidatesByProvider(
  availableModels: Set<string>,
  providers?: string[],
): string[] {
  const candidates = Array.from(availableModels)
  if (!providers || providers.length === 0) {
    return candidates
  }

  const providerSet = new Set(providers)
  return candidates.filter((candidate) => {
    const [provider] = candidate.split("/")
    return providerSet.has(provider)
  })
}

function chooseShortestMatch(matches: string[]): string | undefined {
  return matches.reduce<string | undefined>((shortest, current) => {
    if (!shortest || current.length < shortest.length) {
      return current
    }

    return shortest
  }, undefined)
}

function findExactExplicitMatch(
  modelID: string,
  availableModels: Set<string>,
  providers?: string[],
): string | undefined {
  if (availableModels.size === 0) {
    return undefined
  }

  const candidates = filterCandidatesByProvider(availableModels, providers)
  if (candidates.length === 0) {
    return undefined
  }

  const requestedModelID = modelID.trim().toLowerCase()
  const rawMatches = candidates.filter(
    (candidate) => candidate.split("/").slice(1).join("/").trim().toLowerCase() === requestedModelID,
  )
  if (rawMatches.length > 0) {
    return chooseShortestMatch(rawMatches)
  }

  const normalizedRequestedModelID = normalizeModelID(requestedModelID)
  const normalizedMatches = candidates.filter(
    (candidate) =>
      normalizeModelID(candidate.split("/").slice(1).join("/").trim().toLowerCase()) === normalizedRequestedModelID,
  )
  return chooseShortestMatch(normalizedMatches)
}

export function resolveExplicitModel(
  explicitModel: string | undefined,
  input: { availableModels: Set<string> },
): string | undefined {
  const normalizedModel = normalizeModel(explicitModel)
  if (!normalizedModel) {
    return undefined
  }

  const parsedModel = normalizeModelFormat(normalizedModel)
  if (!parsedModel) {
    const canonicalModelID = canonicalizeExplicitModelID(normalizedModel)
    const match = findExactExplicitMatch(canonicalModelID, input.availableModels)
    if (match) {
      return match
    }

    return canonicalModelID
  }

  const providerID = parsedModel.providerID.trim().toLowerCase()
  const canonicalModelID = canonicalizeExplicitModelID(parsedModel.modelID)
  const directMatch = findExactExplicitMatch(canonicalModelID, input.availableModels, [providerID])
  if (directMatch) {
    return directMatch
  }

  if (isFloatingFamilyAlias(canonicalModelID)) {
    return `${providerID}/${canonicalModelID}`
  }

  const transformedModelID = transformModelForProvider(providerID, canonicalModelID, {
    allowFamilyFallback: false,
  })

  const transformedMatch = findExactExplicitMatch(
    transformedModelID,
    input.availableModels,
    [providerID],
  )
  if (transformedMatch) {
    return transformedMatch
  }

  return `${providerID}/${transformedModelID}`
}
