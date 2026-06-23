import type { ProofStep } from "./consequence-graph"
import type { ContaminationResult } from "./contamination-types"
import { TAG_CONTAM_COI, TAG_CONTAM_SEVERANCE } from "./tag-contract"

const BIASED_PREFIXES = ["biased_source:", "coordinated_narrative:", "manipulated_signal:", "outdated:"]

function isCircular(conclusion: string, proofChain: ProofStep[]): boolean {
  return proofChain.some((step) => (step.from ?? step.antecedents ?? []).includes(conclusion))
}

function getTagMatches(tags: string[], pattern: RegExp): string[] {
  return tags.filter((tag) => pattern.test(tag))
}

function detectTaggedContamination(conclusion: string, tags: string[]): ContaminationResult | null {
  const coiMatches = getTagMatches(tags, TAG_CONTAM_COI)
  const severanceMatches = getTagMatches(tags, TAG_CONTAM_SEVERANCE)

  if (coiMatches.length === 0 && severanceMatches.length === 0) {
    return null
  }

  if (coiMatches.length > 0 && severanceMatches.length > 0) {
    return {
      conclusion,
      level: "high",
      axis: "coi+severance",
      reasons: [...coiMatches, ...severanceMatches],
    }
  }

  if (coiMatches.length > 0) {
    return {
      conclusion,
      level: "high",
      axis: "coi",
      reasons: coiMatches,
    }
  }

  return {
    conclusion,
    level: "medium",
    axis: "severance",
    reasons: severanceMatches,
  }
}

export function detectContamination(conclusion: string, proofChain: ProofStep[], tags: string[]): ContaminationResult {
  if (isCircular(conclusion, proofChain)) {
    return { conclusion, level: "high", axis: "framework", reasons: ["circular_proof_dependency"] }
  }

  const taggedResult = detectTaggedContamination(conclusion, tags)
  if (taggedResult) {
    return taggedResult
  }

  const biased = tags.filter((tag) => BIASED_PREFIXES.some((prefix) => tag.startsWith(prefix)))
  if (biased.length > 0) {
    return {
      conclusion,
      level: biased.length > 1 ? "high" : "medium",
      axis: "world",
      reasons: biased,
    }
  }

  return { conclusion, level: "none", axis: null, reasons: [] }
}
