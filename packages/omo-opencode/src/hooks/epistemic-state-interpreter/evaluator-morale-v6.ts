import {
  MoralEvaluatorTuningSchema,
  type MoralContextDefaults,
  type MoralEvaluatorTuning,
} from "../../config/schema/epistemic-v6"
import type { MoraleLabel, MoraleOutput } from "./multi-plane-types"

export type AudienceType = "expert" | "general" | "vulnerable"

export interface MoraleInput {
  conclusion: string
  premiseTags: string[]
  audienceType: AudienceType | null
  conclusionAction: string | null
  hasQualifications: boolean
  competingArgumentCount: number
  defaults: MoralContextDefaults
  tuning?: MoralEvaluatorTuning
}

const DEFAULT_TUNING: MoralEvaluatorTuning = MoralEvaluatorTuningSchema.parse({})

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function resolveAudience(
  audienceType: AudienceType | null,
  defaults: MoralContextDefaults,
): AudienceType | null {
  if (audienceType !== null) {
    return audienceType
  }

  return defaults.require_audience_model ? null : defaults.default_audience
}

function resolveConclusionAction(conclusionAction: string | null, conclusion: string, tuning: MoralEvaluatorTuning): string | null {
  if (conclusionAction !== null) {
    return conclusionAction.toLowerCase()
  }

  const normalizedConclusion = conclusion.toLowerCase()

  for (const action of Object.keys(tuning.action_impact)) {
    if (normalizedConclusion.includes(action)) {
      return action
    }
  }

  return null
}

function evaluateIntention(premiseTags: string[], tuning: MoralEvaluatorTuning): MoraleOutput["intenzione"] {
  let protectionCount = 0
  let exploitationCount = 0

  for (const tag of premiseTags) {
    const normalizedTag = tag.toLowerCase()

    if (tuning.protection_prefixes.some((prefix) => normalizedTag.startsWith(prefix))) {
      protectionCount += 1
    }

    if (tuning.exploitation_prefixes.some((prefix) => normalizedTag.startsWith(prefix))) {
      exploitationCount += 1
    }
  }

  if (protectionCount > exploitationCount) {
    return "benevola"
  }

  if (exploitationCount > protectionCount) {
    return "malevola"
  }

  return "neutra"
}

function hasMoralContext(premiseTags: string[], tuning: MoralEvaluatorTuning): boolean {
  return premiseTags.some((tag) =>
    tuning.moral_trigger_prefixes.some((prefix) => tag.toLowerCase().startsWith(prefix))
  )
}

function deriveMoraleLabel(score: number | null, tuning: MoralEvaluatorTuning): MoraleLabel | null {
  if (score === null) {
    return null
  }

  if (score >= tuning.label_giustificabile_threshold) {
    return "giustificabile"
  }

  return score < tuning.label_problematica_threshold ? "problematica" : "dipendente_dal_contesto"
}

export function evaluateMorale(input: MoraleInput): MoraleOutput {
  const tuning = input.tuning ?? DEFAULT_TUNING
  const audience = resolveAudience(input.audienceType, input.defaults)

  if (input.audienceType === null && !hasMoralContext(input.premiseTags, tuning)) {
    return {
      score: null,
      label: null,
      contesto_sociale: null,
      comprensione_destinatari: null,
      impatto_cascata: 0,
      intenzione: "neutra",
      trasparenza: 0,
      fiducia_risultante: 0,
      reason: "no_moral_context",
    }
  }

  if (audience === null) {
    return {
      score: null,
      label: null,
      contesto_sociale: null,
      comprensione_destinatari: null,
      impatto_cascata: 0,
      intenzione: "neutra",
      trasparenza: 0,
      fiducia_risultante: 0,
      reason: "no_audience_model",
    }
  }

  const comprehension = tuning.comprehension_by_audience[audience]
  const intenzione = evaluateIntention(input.premiseTags, tuning)
  const intentionScore = tuning.intention_score[intenzione]
  const trasparenza = input.hasQualifications ? tuning.transparency_present : tuning.transparency_absent
  const transparencyWeight = tuning.transparency_weight_by_audience[audience]
  const baselineTransparencyWeight = tuning.transparency_weight_by_audience.general
  const action = resolveConclusionAction(input.conclusionAction, input.conclusion, tuning)
  const baseImpact = action === null
    ? tuning.default_action_impact
    : (tuning.action_impact[action] ?? tuning.default_action_impact)
  const contestedness = clamp01(input.competingArgumentCount * tuning.contestedness_decay)
  const impatto_cascata = round3(clamp01(baseImpact + contestedness * tuning.impatto_cascata_contestedness_weight))
  const fiducia_risultante = round3(
    clamp01(
      intentionScore * tuning.fiducia_weights.intention +
        trasparenza * (baselineTransparencyWeight === 0 ? 1 : transparencyWeight / baselineTransparencyWeight) * tuning.fiducia_weights.transparency +
        comprehension * tuning.fiducia_weights.comprehension -
        contestedness * tuning.fiducia_weights.contestedness_penalty,
    ),
  )

  const score = round3(
    clamp01(
      intentionScore * tuning.score_weights.intention +
        trasparenza * tuning.score_weights.transparency +
        comprehension * tuning.score_weights.comprehension +
        (1 - impatto_cascata) * tuning.score_weights.impatto_inverse +
        fiducia_risultante * tuning.score_weights.fiducia,
    ),
  )

  return {
    score,
    label: deriveMoraleLabel(score, tuning),
    contesto_sociale: audience,
    comprensione_destinatari: `${audience} (${comprehension})`,
    impatto_cascata,
    intenzione,
    trasparenza,
    fiducia_risultante,
    reason: null,
  }
}
