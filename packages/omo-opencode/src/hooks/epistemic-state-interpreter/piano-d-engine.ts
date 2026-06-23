import type { AudienceAnalysis } from "../reasoning-core-policy-gate/extended-response-types"
import type {
  AudienceConsensusSummary,
  DominanzaDecisionale,
  ValutazioneMultiAsse,
} from "./multi-plane-types"
import {
  computeParetoDominance,
  getParetoAxisScore,
  PARETO_AXES,
  type ParetoConclusionInput,
  type ParetoResult,
} from "./piano-d-pareto"
import {
  extractAudiencePreferences,
  type AudiencePreferencesResult,
} from "./piano-d-audience-preferences"
import {
  aggregateAudienceConsensus,
  type AudienceConsensusResult,
} from "./piano-d-audience-consensus"

const LEGACY_BLOCKED_PENALTY = 0.5
const LEGACY_UNCERTAIN_MARGIN = 0.3
const LEGACY_SCORE_PRECISION = 10

export interface PianoDInput {
  conclusions: ParetoConclusionInput[]
  audienceAnalysis?: AudienceAnalysis
}

function legacyScore(entry: ParetoConclusionInput): number {
  const base = entry.blocked ? entry.valutazione.combined * LEGACY_BLOCKED_PENALTY : entry.valutazione.combined
  return Number(base.toFixed(LEGACY_SCORE_PRECISION))
}

function buildLegacyRanking(conclusions: ParetoConclusionInput[]) {
  return conclusions
    .map((entry) => ({ conclusion: entry.conclusion, score: legacyScore(entry) }))
    .sort((left, right) => right.score - left.score)
}

function getAxisAlignment(
  superior: ValutazioneMultiAsse,
  inferior: ValutazioneMultiAsse,
): { assi_convergenti: string[]; assi_divergenti: string[] } {
  const assi_convergenti: string[] = []
  const assi_divergenti: string[] = []

  for (const axis of PARETO_AXES) {
    const superiorScore = getParetoAxisScore(superior, axis)
    const inferiorScore = getParetoAxisScore(inferior, axis)
    if (superiorScore > inferiorScore) {
      assi_convergenti.push(axis)
    } else if (superiorScore < inferiorScore) {
      assi_divergenti.push(axis)
    }
  }

  return { assi_convergenti, assi_divergenti }
}

function toAudienceConsensusSummary(result: AudienceConsensusResult): AudienceConsensusSummary | null {
  if (result.consensus === "no_data" && result.no_selection_audiences.length === 0) {
    return null
  }
  return {
    kind: result.consensus,
    choice: result.consensus_choice,
    agreeing_audiences: result.agreeing_audiences,
    dissenting_audiences: result.dissenting_audiences,
    no_selection_audiences: result.no_selection_audiences,
  }
}

function pickDominant(input: {
  pareto: ParetoResult
  consensus: AudienceConsensusResult
  conclusionCount: number
}): { dominante: string | null; decision_kind: DominanzaDecisionale["decision_kind"] } {
  if (input.conclusionCount === 0) {
    return { dominante: null, decision_kind: "empty" }
  }
  if (input.pareto.pareto_optimal.length === 0) {
    return { dominante: null, decision_kind: "all_blocked" }
  }
  if (input.pareto.pareto_optimal.length === 1) {
    return { dominante: input.pareto.pareto_optimal[0], decision_kind: "pareto_unique" }
  }
  const choice = input.consensus.consensus_choice
  if (choice && input.pareto.pareto_optimal.includes(choice)) {
    if (input.consensus.consensus === "unanimous") {
      return { dominante: choice, decision_kind: "pareto_with_audience_consensus" }
    }
    if (input.consensus.consensus === "majority") {
      return { dominante: choice, decision_kind: "pareto_with_audience_majority" }
    }
  }
  return { dominante: null, decision_kind: "contested" }
}

export function computePianoD(input: PianoDInput): DominanzaDecisionale {
  const conclusionsByName = new Map(input.conclusions.map((entry) => [entry.conclusion, entry]))
  const pareto = computeParetoDominance({ conclusions: input.conclusions })
  const audiencePreferences: AudiencePreferencesResult = extractAudiencePreferences({
    audienceAnalysis: input.audienceAnalysis,
    paretoOptimal: pareto.pareto_optimal,
    knownConclusions: input.conclusions.map((entry) => entry.conclusion),
  })
  const consensusResult = aggregateAudienceConsensus({
    per_audience: audiencePreferences.per_audience,
    paretoOptimal: pareto.pareto_optimal,
  })

  const ranking = buildLegacyRanking(input.conclusions)
  const { dominante, decision_kind } = pickDominant({
    pareto,
    consensus: consensusResult,
    conclusionCount: input.conclusions.length,
  })

  const margine = ranking.length >= 2
    ? Number((ranking[0].score - ranking[1].score).toFixed(LEGACY_SCORE_PRECISION))
    : ranking.length === 1 ? 1 : 0

  let assi_convergenti: string[] = []
  let assi_divergenti: string[] = []
  if (input.conclusions.length === 1) {
    assi_convergenti = [...PARETO_AXES]
  } else if (ranking.length >= 2) {
    const top = conclusionsByName.get(ranking[0].conclusion)
    const second = conclusionsByName.get(ranking[1].conclusion)
    if (top && second) {
      const alignment = getAxisAlignment(top.valutazione, second.valutazione)
      assi_convergenti = alignment.assi_convergenti
      assi_divergenti = alignment.assi_divergenti
    }
  }

  const preferibile_ma_non_certo = dominante !== null
    && (margine < LEGACY_UNCERTAIN_MARGIN || assi_divergenti.length > 0 || decision_kind === "pareto_with_audience_majority")

  return {
    ranking,
    dominante,
    margine,
    preferibile_ma_non_certo,
    assi_convergenti,
    assi_divergenti,
    pareto_optimal: pareto.pareto_optimal,
    incomparable_pairs: pareto.incomparable_pairs,
    audience_consensus: toAudienceConsensusSummary(consensusResult),
    decision_kind,
  }
}
