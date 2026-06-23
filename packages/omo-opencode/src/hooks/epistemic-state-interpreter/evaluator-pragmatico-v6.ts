import type { PragmaticoLabel, PragmaticoOutput } from "./multi-plane-types"
import {
  PragmaticEvaluatorTuningSchema,
  type PragmaticEvaluatorTuning,
  type PragmaticWeights,
} from "../../config/schema/epistemic-v6"

const DEFAULT_TUNING: PragmaticEvaluatorTuning = PragmaticEvaluatorTuningSchema.parse({})

export interface PragmaticoInput {
  conclusion: string
  proofChainKind: "strict" | "defeasible" | "mixed" | "unknown"
  extensionMembership: { inCount: number; totalCount: number }
  competingConclusionCount: number
  hasStrongAttackers: boolean
  weights: PragmaticWeights
  tuning?: PragmaticEvaluatorTuning
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function getExtensionRatio(extensionMembership: PragmaticoInput["extensionMembership"]): number {
  if (extensionMembership.totalCount <= 0) {
    return 0
  }

  return extensionMembership.inCount / extensionMembership.totalCount
}

function getCompetitionFactor(competingConclusionCount: number, decay: number): number {
  if (competingConclusionCount <= 0) {
    return 1
  }

  return 1 / (1 + competingConclusionCount * decay)
}


function derivePragmaticoLabel(score: number, tuning: PragmaticEvaluatorTuning): PragmaticoLabel {
  if (score >= tuning.label_conveniente_threshold) {
    return "conveniente"
  }

  return score < tuning.label_sconveniente_threshold ? "sconveniente" : "condizionata"
}

export function evaluatePragmatico(input: PragmaticoInput): PragmaticoOutput {
  const tuning = input.tuning ?? DEFAULT_TUNING
  const proofFactor = tuning.proof_strength_by_kind[input.proofChainKind] ?? tuning.proof_strength_by_kind.unknown
  const extensionRatio = getExtensionRatio(input.extensionMembership)
  const competitionFactor = getCompetitionFactor(input.competingConclusionCount, tuning.competition_factor_decay)
  const attackAllowance = input.hasStrongAttackers
    ? tuning.attack_allowance_with_attackers
    : tuning.attack_allowance_no_attackers

  const beneficio_proprio = clamp01(
    proofFactor * tuning.beneficio_proprio_weights.proof +
      extensionRatio * tuning.beneficio_proprio_weights.extension +
      attackAllowance * tuning.beneficio_proprio_weights.attack_allowance,
  )
  const beneficio_controparte = clamp01(
    extensionRatio * tuning.beneficio_controparte_weights.extension +
      competitionFactor * tuning.beneficio_controparte_weights.competition,
  )
  const costo_proprio = clamp01(1 - beneficio_proprio)
  const costo_controparte = clamp01(1 - beneficio_controparte)

  const weightedBenefit =
    beneficio_proprio * input.weights.peso_proprio +
    beneficio_controparte * input.weights.peso_controparte
  const weightedCost =
    costo_proprio * input.weights.peso_proprio +
    costo_controparte * input.weights.peso_controparte
  const score = round3(clamp01(weightedBenefit - weightedCost * tuning.cost_subtraction_factor))

  return {
    score,
    label: derivePragmaticoLabel(score, tuning),
    beneficio_proprio: round3(beneficio_proprio),
    beneficio_controparte: round3(beneficio_controparte),
    costo_proprio: round3(costo_proprio),
    costo_controparte: round3(costo_controparte),
    pesatura: {
      proprio: input.weights.peso_proprio,
      controparte: input.weights.peso_controparte,
    },
  }
}
