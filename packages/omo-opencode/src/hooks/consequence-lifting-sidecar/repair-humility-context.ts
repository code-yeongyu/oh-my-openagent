import type { CertaintyLevel } from "./certainty-types"
import type {
  QualifiedPolicy,
} from "./types"
import type {
  RepairHumilityConfidenceScores,
  RepairHumilityContext,
  RepairHumilityConvergenceStatus,
  RepairHumilitySemanticsComparison,
} from "./repair-humility-types"

const CERTAINTY_SCORE_MAP: Record<CertaintyLevel, number> = {
  high: 0.85,
  medium: 0.55,
  low: 0.25,
}

export function buildRepairHumilityContext(input: {
  proofArtifact: unknown
  selectedPolicy: QualifiedPolicy | undefined
  selectedDecision: string | undefined
}): RepairHumilityContext {
  const rawConfidence = extractConfidenceScores(input.proofArtifact)
  const fallbackConfidence = deriveConfidenceFromPolicy(input.selectedPolicy)

  return {
    selectedDecision: resolveSelectedDecision(input) ?? null,
    semanticsComparison: extractSemanticsComparison(input.proofArtifact),
    confidence: mergeConfidenceScores(rawConfidence, fallbackConfidence),
    preferenceCycleDetected: extractPreferenceCycleDetected(input.proofArtifact),
    preferenceCyclePath: extractStringArray(getPayloadValue(input.proofArtifact, "preference_cycle_path")),
    convergence: extractConvergenceStatus(input.proofArtifact),
    revisedPremises: extractStringArray(getPayloadValue(input.proofArtifact, "revised_premises")),
  }
}

function resolveSelectedDecision(input: {
  proofArtifact: unknown
  selectedPolicy: QualifiedPolicy | undefined
  selectedDecision: string | undefined
}): string | undefined {
  return input.selectedDecision
    ?? input.selectedPolicy?.primaryDecision
    ?? extractSingleAcceptedConclusion(input.proofArtifact)
}

function extractSemanticsComparison(proofArtifact: unknown): RepairHumilitySemanticsComparison | undefined {
  const raw = getPayloadValue(proofArtifact, "semantics_comparison")
  if (!isRecord(raw)) return undefined

  const certaintyGradient = isRecord(raw.certainty_gradient) ? raw.certainty_gradient : {}
  return {
    grounded_set: extractStringArray(raw.grounded_set) ?? [],
    preferred_extensions: extractStringMatrix(raw.preferred_extensions),
    stable_extensions: extractStringMatrix(raw.stable_extensions),
    complete_extensions: extractStringMatrix(raw.complete_extensions),
    certainty_gradient: {
      certain: extractStringArray(certaintyGradient.certain) ?? [],
      defensible: extractStringArray(certaintyGradient.defensible) ?? [],
      contested: extractStringArray(certaintyGradient.contested) ?? [],
    },
  }
}

function extractConfidenceScores(proofArtifact: unknown): RepairHumilityConfidenceScores | undefined {
  const raw = getPayloadValue(proofArtifact, "confidence")
  if (!isRecord(raw)) return undefined

  const framework = typeof raw.framework_certainty === "number" ? raw.framework_certainty : undefined
  const world = typeof raw.world_certainty === "number" ? raw.world_certainty : undefined
  if (framework === undefined && world === undefined) return undefined

  return {
    framework_certainty: framework,
    world_certainty: world,
  }
}

function deriveConfidenceFromPolicy(selectedPolicy: QualifiedPolicy | undefined): RepairHumilityConfidenceScores | undefined {
  if (!selectedPolicy) return undefined

  return {
    framework_certainty: mapCertaintyToScore(selectedPolicy.profile.framework_certainty),
    world_certainty: mapCertaintyToScore(selectedPolicy.profile.world_certainty),
  }
}

function mergeConfidenceScores(
  primary: RepairHumilityConfidenceScores | undefined,
  fallback: RepairHumilityConfidenceScores | undefined,
): RepairHumilityConfidenceScores | undefined {
  const framework = primary?.framework_certainty ?? fallback?.framework_certainty
  const world = primary?.world_certainty ?? fallback?.world_certainty
  if (framework === undefined && world === undefined) return undefined

  return {
    framework_certainty: framework,
    world_certainty: world,
  }
}

function extractPreferenceCycleDetected(proofArtifact: unknown): boolean | undefined {
  const raw = getPayloadValue(proofArtifact, "preference_cycle_detected")
  return typeof raw === "boolean" ? raw : undefined
}

function extractConvergenceStatus(proofArtifact: unknown): RepairHumilityConvergenceStatus | undefined {
  const raw = getPayloadValue(proofArtifact, "convergence")
  if (raw === "converged" || raw === "looping" || raw === "not_converged" || raw === "unable_to_converge") {
    return raw
  }
  return undefined
}

function extractSingleAcceptedConclusion(proofArtifact: unknown): string | undefined {
  const result = getRecord(proofArtifact, "result")
  const extensions = Array.isArray(result.extensions) ? result.extensions : []
  const acceptedInExtensions = extensions.flatMap((extension) => {
    if (!isRecord(extension) || !Array.isArray(extension.accepted_conclusions)) return []
    return extension.accepted_conclusions.filter((value): value is string => typeof value === "string")
  })
  const uniqueAcceptedInExtensions = [...new Set(acceptedInExtensions)]
  if (uniqueAcceptedInExtensions.length === 1) return uniqueAcceptedInExtensions[0]

  const conclusions = getRecord(result, "conclusions")
  const acceptedByStatus = Object.entries(conclusions)
    .filter(([, entry]) => isRecord(entry) && entry.status === "Accepted")
    .map(([conclusion]) => conclusion)
  return acceptedByStatus.length === 1 ? acceptedByStatus[0] : undefined
}

function getPayloadValue(proofArtifact: unknown, key: string): unknown {
  if (isRecord(proofArtifact) && key in proofArtifact) return proofArtifact[key]
  const result = getRecord(proofArtifact, "result")
  if (isRecord(result) && key in result) return result[key]
  return undefined
}

function getRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value[key])) return {}
  return value[key]
}

function extractStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function extractStringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => Array.isArray(entry) ? [entry.filter((item): item is string => typeof item === "string")] : [])
}

function mapCertaintyToScore(level: CertaintyLevel | null | undefined): number | undefined {
  if (!level) return undefined
  return CERTAINTY_SCORE_MAP[level]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
