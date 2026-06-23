import type { ProofChainKind } from "./types.ts"
import { extractProofArtifactAttackMetadata } from "./proof-artifact-attack-metadata"
import { normalizeProofArtifact } from "./normalize-proof-artifact"

export interface ParsedConclusion {
  status: string
  proofChainKind: ProofChainKind
  hasResidualDefeasibleSupport: boolean
  extensionsIn: number
  rebuttedConclusions: string[]
  underminedPremises: string[]
  undercutRules: string[]
  premiseTags?: string[]
}

export interface ParsedProofArtifact {
  extensionCount: number
  conclusions: Map<string, ParsedConclusion>
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

export function parseProofChainKind(value: unknown): ProofChainKind | null {
  if (value === undefined || value === null) {
    return "unknown"
  }

  if (!Array.isArray(value)) {
    return null
  }

  let hasStrict = false
  let hasDefeasible = false
  let hasNonOrdinary = false

  for (const step of value) {
    if (!isRecord(step) || !isString(step.rule_kind)) {
      return null
    }

    if (step.rule_kind === "ordinary" || step.rule_kind === "axiom" || step.rule_kind === "csp_derived") {
      continue
    }

    hasNonOrdinary = true

    if (step.rule_kind === "strict") {
      hasStrict = true
      continue
    }

    if (step.rule_kind === "defeasible") {
      hasDefeasible = true
      continue
    }

    return null
  }

  if (!hasNonOrdinary) {
    return "unknown"
  }

  if (hasStrict && hasDefeasible) {
    return "mixed"
  }

  if (hasStrict) {
    return "strict"
  }

  if (hasDefeasible) {
    return "defeasible"
  }

  return "unknown"
}

function hasResidualDefeasibleSupport(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }

  if (!Array.isArray(value)) {
    return false
  }

  for (const step of value) {
    if (!isRecord(step) || !isString(step.rule_kind)) {
      return false
    }

    if (step.rule_kind === "defeasible") {
      return true
    }
  }

  return false
}

function countExtensionsIn(extensions: unknown, conclusion: string): number | null {
  if (!Array.isArray(extensions)) {
    return null
  }

  let count = 0

  for (const extension of extensions) {
    if (!isRecord(extension) || !Array.isArray(extension.accepted_conclusions)) {
      return null
    }

    for (const acceptedConclusion of extension.accepted_conclusions) {
      if (!isString(acceptedConclusion)) {
        return null
      }
    }

    if (extension.accepted_conclusions.includes(conclusion)) {
      count += 1
    }
  }

  return count
}

export function parseProofArtifact(raw: unknown): ParsedProofArtifact | null {
  try {
    const artifact = normalizeProofArtifact(raw)
    if (!isRecord(artifact) || !isRecord(artifact.result)) {
      return null
    }

    const { result } = artifact
    const { conclusions, extensions } = result

    if (!isRecord(conclusions) || !Array.isArray(extensions)) {
      return null
    }

    const parsedConclusions = new Map<string, ParsedConclusion>()

    for (const [conclusion, entry] of Object.entries(conclusions)) {
      if (!isRecord(entry)) {
        return null
      }

      const proofChainKind = parseProofChainKind(entry.proof_chain)
      if (proofChainKind === null) {
        return null
      }

      const extensionsIn = countExtensionsIn(extensions, conclusion)
      if (extensionsIn === null) {
        return null
      }

      const attackMetadata = extractProofArtifactAttackMetadata(entry.attacks)

      parsedConclusions.set(conclusion, {
        status: isString(entry.status) ? entry.status : "",
        proofChainKind,
        hasResidualDefeasibleSupport:
          isString(entry.status) && entry.status === "Rejected"
            ? hasResidualDefeasibleSupport(entry.proof_chain)
            : false,
        extensionsIn,
        rebuttedConclusions: attackMetadata.rebuttedConclusions,
        underminedPremises: attackMetadata.underminedPremises,
        undercutRules: attackMetadata.undercutRules,
      })
    }

    return {
      extensionCount: extensions.length,
      conclusions: parsedConclusions,
    }
  } catch {
    return null
  }
}
