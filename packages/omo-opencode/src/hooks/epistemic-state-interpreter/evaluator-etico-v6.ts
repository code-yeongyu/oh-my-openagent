import {
  EthicalEvaluatorTuningSchema,
  type EthicalEvaluatorTuning,
  type EthicalValueHierarchy,
} from "../../config/schema/epistemic-v6"
import type { EticoLabel } from "./multi-plane-types"
import type { EticoOutput } from "./multi-plane-types"

const DEFAULT_TUNING: EthicalEvaluatorTuning = EthicalEvaluatorTuningSchema.parse({})

export interface EticoInput {
  conclusion: string
  proofChainKind: "strict" | "defeasible" | "mixed" | "unknown"
  premiseTags: string[]
  extensionMembership: { inCount: number; totalCount: number }
  valueHierarchy: EthicalValueHierarchy
  tuning?: EthicalEvaluatorTuning
}

function roundToThreeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000
}

function hasPrefix(tag: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => tag.startsWith(prefix))
}

function getTagValue(tag: string): string | null {
  const separatorIndex = tag.indexOf(":")
  if (separatorIndex === -1 || separatorIndex === tag.length - 1) {
    return null
  }

  return tag.slice(separatorIndex + 1)
}

function getExtensionConsensus(extensionMembership: EticoInput["extensionMembership"]): number {
  if (extensionMembership.totalCount <= 0) {
    return 1
  }

  const rawConsensus = extensionMembership.inCount / extensionMembership.totalCount
  return Math.min(1, Math.max(0, rawConsensus))
}

function getLegalAlignment(premiseTags: string[], tuning: EthicalEvaluatorTuning): number {
  const legalTags = premiseTags.filter((tag) => hasPrefix(tag, tuning.legal_tag_prefixes))

  if (legalTags.length === 0) {
    return tuning.legal_alignment_base
  }

  return Math.min(1, tuning.legal_alignment_floor + legalTags.length * tuning.legal_alignment_per_tag)
}

function getEthicalValueScores(
  premiseTags: string[],
  valueHierarchy: EthicalValueHierarchy,
  tuning: EthicalEvaluatorTuning,
): Pick<EticoOutput, "valore_empatico" | "magnitudine_beneficio"> {
  let valore_empatico = 0
  let magnitudine_beneficio = 0

  for (const tag of premiseTags) {
    if (!hasPrefix(tag, tuning.ethical_tag_prefixes)) {
      continue
    }

    const valueName = getTagValue(tag)
    if (valueName === null) {
      continue
    }

    const hierarchyIndex = valueHierarchy.indexOf(valueName)
    if (hierarchyIndex === -1) {
      continue
    }

    const normalizedValue = 1 - hierarchyIndex / Math.max(valueHierarchy.length - 1, 1)
    valore_empatico = Math.max(valore_empatico, normalizedValue)
    magnitudine_beneficio = Math.max(magnitudine_beneficio, normalizedValue * tuning.empathy_benefit_multiplier)
  }

  return { valore_empatico, magnitudine_beneficio }
}

function hasEthicalContext(premiseTags: string[], tuning: EthicalEvaluatorTuning): boolean {
  return premiseTags.some(
    (tag) => hasPrefix(tag, tuning.legal_tag_prefixes) || hasPrefix(tag, tuning.ethical_tag_prefixes)
  )
}

function deriveEticoLabel(score: number, override: boolean, tuning: EthicalEvaluatorTuning): EticoLabel {
  if (override) {
    return "override_giustificato"
  }

  return score >= tuning.label_lecito_threshold ? "lecito" : "illecito"
}

export function evaluateEtico(input: EticoInput): EticoOutput {
  const tuning = input.tuning ?? DEFAULT_TUNING
  const premiseTags = [...new Set(input.premiseTags)]

  if (!hasEthicalContext(premiseTags, tuning)) {
    return {
      score: null,
      label: null,
      allineamento_legale: 0,
      valore_empatico: 0,
      magnitudine_beneficio: 0,
      override: false,
      reason: "no_ethical_context",
    }
  }

  const allineamento_legale = getLegalAlignment(premiseTags, tuning)
  const { valore_empatico, magnitudine_beneficio } = getEthicalValueScores(
    premiseTags,
    input.valueHierarchy,
    tuning,
  )

  const proofStrength = tuning.proof_strength_by_kind[input.proofChainKind] ?? tuning.proof_strength_by_kind.unknown
  const extensionConsensus = getExtensionConsensus(input.extensionMembership)
  const validita_logica = proofStrength * extensionConsensus
  const legalCost = 1 - allineamento_legale
  const empathyBenefit = valore_empatico + magnitudine_beneficio
  const protectsHigherValue = valore_empatico > tuning.override_higher_value_threshold
  const override =
    allineamento_legale < tuning.override_legal_threshold &&
    empathyBenefit > legalCost * tuning.override_empathy_cost_ratio &&
    protectsHigherValue

  const score = override
    ? valore_empatico * tuning.override_score_weights.empathy +
      magnitudine_beneficio * tuning.override_score_weights.magnitude +
      validita_logica * tuning.override_score_weights.validity
    : allineamento_legale * tuning.default_score_weights.legal +
      validita_logica * tuning.default_score_weights.validity +
      valore_empatico * tuning.default_score_weights.empathy

  return {
    score: roundToThreeDecimals(score),
    label: deriveEticoLabel(score, override, tuning),
    allineamento_legale,
    valore_empatico,
    magnitudine_beneficio,
    override,
    reason: null,
  }
}
