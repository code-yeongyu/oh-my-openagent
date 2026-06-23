import type { CertaintyLevel, CertaintySplitInput, SplitCertainty } from "./certainty-types"

const EMPIRICAL_PREFIXES = ["evidence:", "data:", "observation:"]

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getRuleCounts(input: CertaintySplitInput): { strict: number; defeasible: number } {
  return (input.proofChain ?? []).reduce(
    (counts, step) => {
      if (step.rule_kind === "strict") counts.strict += 1
      if (step.rule_kind === "defeasible") counts.defeasible += 1
      return counts
    },
    { strict: 0, defeasible: 0 },
  )
}

function getStrictStrength(input: CertaintySplitInput): number | null {
  const counts = getRuleCounts(input)
  const total = counts.strict + counts.defeasible
  if (total > 0) return counts.strict / total
  if (input.proofChainKind === "strict") return 1
  if (input.proofChainKind === "mixed") return 0.6
  if (input.proofChainKind === "defeasible") return 0.2
  if (input.proofChainKind === "unknown") return 0.35
  return null
}

function getDefeasibleStrength(input: CertaintySplitInput): number | null {
  const counts = getRuleCounts(input)
  const total = counts.strict + counts.defeasible
  if (total > 0) return counts.defeasible / total
  if (input.proofChainKind === "defeasible") return 1
  if (input.proofChainKind === "mixed") return 0.65
  if (input.proofChainKind === "strict") return 0.2
  if (input.proofChainKind === "unknown") return 0.35
  return null
}

function getConsensusStrength(input: CertaintySplitInput): number | null {
  const membership = input.extensionMembership
  if (!membership || membership.totalCount <= 0) return null
  const ratio = clamp(membership.inCount / membership.totalCount)
  if (ratio === 1) return 1
  if (ratio >= 0.5) return 0.5
  return 0.2
}

function getEmpiricalStrength(tags: string[] | null | undefined): number | null {
  if (!tags) return null
  const empiricalCount = tags.filter((tag) => EMPIRICAL_PREFIXES.some((prefix) => tag.startsWith(prefix))).length
  if (empiricalCount >= 2) return 1
  if (empiricalCount === 1) return 0.5
  return 0
}

function toLevel(strength: number | null): CertaintyLevel | null {
  if (strength === null) return null
  if (strength >= 0.75) return "high"
  if (strength >= 0.45) return "medium"
  return "low"
}

function applyContaminationDiscount(
  value: number | null,
  axis: "world" | "framework",
  level: "none" | "low" | "medium" | "high" | undefined,
  contaminationAxis: string | null | undefined,
): number | null {
  if (value === null || !level || level === "none" || contaminationAxis !== axis) return value
  const multiplier = level === "high" ? 0.5 : level === "medium" ? 0.75 : 0.9
  return clamp(value * multiplier)
}

function getFrameworkStrength(input: CertaintySplitInput): number | null {
  const strictStrength = getStrictStrength(input)
  const consensusStrength = getConsensusStrength(input)
  if (strictStrength === null && consensusStrength === null) return null
  if (strictStrength === null) return consensusStrength
  if (consensusStrength === null) return strictStrength
  return Math.min(strictStrength, consensusStrength)
}

function getWorldStrength(input: CertaintySplitInput): number | null {
  const empiricalStrength = getEmpiricalStrength(input.tags)
  const defeasibleStrength = getDefeasibleStrength(input)
  const consensusStrength = getConsensusStrength(input)

  if (empiricalStrength === null && defeasibleStrength === null && consensusStrength === null) return null

  const supportStrength =
    defeasibleStrength === null || consensusStrength === null
      ? defeasibleStrength ?? consensusStrength
      : (defeasibleStrength + consensusStrength) / 2

  if (empiricalStrength === null) return supportStrength ?? null
  if (supportStrength === null) return empiricalStrength

  const boostedStrength = Math.min(empiricalStrength, supportStrength) + (defeasibleStrength !== null && defeasibleStrength >= 0.65 ? 0.15 : 0)
  return clamp(boostedStrength)
}

export function splitCertainty(input: CertaintySplitInput): SplitCertainty {
  const framework = applyContaminationDiscount(getFrameworkStrength(input), "framework", input.contaminationLevel, input.contaminationAxis)
  const world = applyContaminationDiscount(getWorldStrength(input), "world", input.contaminationLevel, input.contaminationAxis)
  return {
    framework_certainty: toLevel(framework),
    world_certainty: toLevel(world),
  }
}
