import type {
  EticoOutput,
  MoraleOutput,
  PragmaticoOutput,
  ValutazioneMultiAsse,
} from "./multi-plane-types"

const DEFAULT_WEIGHTS = {
  logico: 0.40,
  probabilistico: 0.30,
  etico: 0.00,
  pragmatico: 0.30,
  morale: 0.00,
} as const

type Axis = keyof typeof DEFAULT_WEIGHTS

type AxisScores = Record<Axis, number>
type AxisWeights = Record<Axis, number>

export interface PreferenceDerivationInput {
  conclusion: string
  logico: number
  probabilistico: number
  etico: EticoOutput
  pragmatico: PragmaticoOutput
  morale: MoraleOutput
}

export interface DerivationStep {
  axis: string
  rawScore: number
  adjustedScore: number
  weight: number
  contribution: number
  note: string | null
}

export interface DerivedPreference {
  conclusion: string
  scores: AxisScores
  combined: number
  divergente: boolean
  dettaglio_divergenza: string | null
  derivationTrace: DerivationStep[]
  blocked: boolean
  blockReason: string | null
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function joinNotes(notes: string[]): string | null {
  return notes.length === 0 ? null : notes.join("|")
}

function getScores(input: PreferenceDerivationInput): AxisScores {
  return {
    logico: clamp01(input.logico),
    probabilistico: clamp01(input.probabilistico),
    etico: input.etico.score === null ? 0 : clamp01(input.etico.score),
    pragmatico: clamp01(input.pragmatico.score),
    morale: input.morale.score === null ? 0 : clamp01(input.morale.score),
  }
}

function getWeights(
  eticoScore: EticoOutput["score"],
  moraleScore: MoraleOutput["score"]
): AxisWeights {
  const eticoActive = eticoScore !== null
  const moraleActive = moraleScore !== null

  if (eticoActive && moraleActive) {
    return { ...DEFAULT_WEIGHTS }
  }

  let inactiveWeight = 0
  if (!eticoActive) {
    inactiveWeight += DEFAULT_WEIGHTS.etico
  }
  if (!moraleActive) {
    inactiveWeight += DEFAULT_WEIGHTS.morale
  }

  const activeAxes = 3 + (eticoActive ? 1 : 0) + (moraleActive ? 1 : 0)
  const redistributed = activeAxes > 0 ? inactiveWeight / activeAxes : 0

  return {
    logico: round4(DEFAULT_WEIGHTS.logico + redistributed),
    probabilistico: round4(DEFAULT_WEIGHTS.probabilistico + redistributed),
    etico: eticoActive ? round4(DEFAULT_WEIGHTS.etico + redistributed) : 0,
    pragmatico: round4(DEFAULT_WEIGHTS.pragmatico + redistributed),
    morale: moraleActive ? round4(DEFAULT_WEIGHTS.morale + redistributed) : 0,
  }
}

function getDivergenceDetail(
  scores: AxisScores,
  eticoScore: EticoOutput["score"],
  moraleScore: MoraleOutput["score"],
): string | null {
  const details: string[] = []

  if (eticoScore !== null) {
    const eticoPragmaticoDelta = Math.abs(scores.etico - scores.pragmatico)

    if (eticoPragmaticoDelta > 0.3) {
      details.push(`etico e pragmatico divergono di ${round4(eticoPragmaticoDelta)}`)
    }
  }

  if (moraleScore !== null) {
    const eticoMoraleDelta = Math.abs(scores.etico - scores.morale)
    if (eticoMoraleDelta > 0.3) {
      details.push(`etico e morale divergono di ${round4(eticoMoraleDelta)}`)
    }
  }

  return details.length === 0 ? null : details.join("; ")
}

export function derivePreference(input: PreferenceDerivationInput): DerivedPreference {
  const scores = getScores(input)
  const weights = getWeights(input.etico.score, input.morale.score)
  const blocked = false
  const penaltyFactor = 1
  const blockReason = null
  const dettaglio_divergenza = getDivergenceDetail(scores, input.etico.score, input.morale.score)

  const derivationTrace = Object.entries(scores).map(([axis, rawScore]) => {
    const notes: string[] = []

    if (input.morale.score === null) {
      notes.push("morale_null_redistributed")
    }
    if (input.etico.score === null) {
      notes.push("etico_null_redistributed")
    }
    if (blocked) {
      notes.push("etico_block_penalty")
    }

    const weight = weights[axis as Axis]
    const adjustedScore = round4(rawScore * penaltyFactor)
    const contribution = round4(adjustedScore * weight)

    return {
      axis,
      rawScore,
      adjustedScore,
      weight,
      contribution,
      note: joinNotes(notes),
    }
  })

  return {
    conclusion: input.conclusion,
    scores,
    combined: round4(derivationTrace.reduce((sum, step) => sum + step.contribution, 0)),
    divergente: dettaglio_divergenza !== null,
    dettaglio_divergenza,
    derivationTrace,
    blocked,
    blockReason,
  }
}

export function toValutazioneMultiAsse(
  derived: DerivedPreference,
  input: PreferenceDerivationInput,
): ValutazioneMultiAsse {
  return {
    logico: input.logico,
    probabilistico: input.probabilistico,
    etico: input.etico,
    pragmatico: input.pragmatico,
    morale: input.morale,
    combined: derived.combined,
    divergente: derived.divergente,
    dettaglio_divergenza: derived.dettaglio_divergenza,
  }
}
