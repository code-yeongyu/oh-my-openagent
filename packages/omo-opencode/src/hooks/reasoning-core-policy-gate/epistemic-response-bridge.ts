import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import type {
  EticoOutput,
  MoraleOutput,
  PragmaticoOutput,
} from "../epistemic-state-interpreter/multi-plane-types"
import type { EpistemicAnalysis, PianoCEticoAnalysis } from "./extended-response-types"

type StateEvaluationCarrier = {
  etico?: EticoOutput
  morale?: MoraleOutput
  pragmatico?: PragmaticoOutput
}

function toStringRecord(entries: Array<readonly [string, string | null | undefined]>): Record<string, string> | undefined {
  const record = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"))
  return Object.keys(record).length > 0 ? record : undefined
}

function toNumberRecord(entries: Array<readonly [string, number | null | undefined]>): Record<string, number> | undefined {
  const record = Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => typeof entry[1] === "number"))
  return Object.keys(record).length > 0 ? record : undefined
}

function toObjectRecord<T extends object>(entries: Array<readonly [string, T | null | undefined]>): Record<string, T> | undefined {
  const record = Object.fromEntries(entries.filter((entry): entry is readonly [string, T] => entry[1] !== null && entry[1] !== undefined))
  return Object.keys(record).length > 0 ? record : undefined
}

function clampConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0
  }

  return Math.max(0, Math.min(1, value))
}

function getStateEvaluation<K extends keyof StateEvaluationCarrier>(
  processedConclusion: ProcessedConclusion,
  key: K,
): StateEvaluationCarrier[K] | undefined {
  const state = processedConclusion.annotation.state as ProcessedConclusion["annotation"]["state"] & StateEvaluationCarrier
  return state[key]
}

function getEticoOutput(processedConclusion: ProcessedConclusion): EticoOutput | undefined {
  return processedConclusion.valutazione?.etico ?? processedConclusion.annotation.valutazione?.etico ?? getStateEvaluation(processedConclusion, "etico")
}

function getMoraleOutput(processedConclusion: ProcessedConclusion): MoraleOutput | undefined {
  return processedConclusion.valutazione?.morale ?? processedConclusion.annotation.valutazione?.morale ?? getStateEvaluation(processedConclusion, "morale")
}

function getPragmaticoOutput(processedConclusion: ProcessedConclusion): PragmaticoOutput | undefined {
  return processedConclusion.valutazione?.pragmatico ?? processedConclusion.annotation.valutazione?.pragmatico ?? getStateEvaluation(processedConclusion, "pragmatico")
}

function describeRankedConclusion(conclusion: string): string {
  if (conclusion.startsWith("-")) {
    return `rejection of ${conclusion.slice(1)}`
  }

  return conclusion
}

function createPianoD(processed: ProcessedConclusion[]): EpistemicAnalysis["piano_d"] | undefined {
  const pianoD = processed[0]?.annotation.state.pianoD

  if (!pianoD) {
    return undefined
  }

  if (pianoD.dominante) {
    return {
      synthesis: `Dominant conclusion: ${describeRankedConclusion(pianoD.dominante)} (margin ${pianoD.margine.toFixed(4)}).`,
      dominant_conclusion: pianoD.dominante,
      confidence: clampConfidence(pianoD.ranking[0]?.score),
    }
  }

  const leadConclusion = pianoD.ranking[0]?.conclusion
  const synthesis = leadConclusion
    ? `No dominant conclusion. Strongest signal is ${describeRankedConclusion(leadConclusion)} (margin ${pianoD.margine.toFixed(4)}).`
    : "No ranked conclusions available."

  return {
    synthesis,
    confidence: clampConfidence(pianoD.ranking[0]?.score),
  }
}

function createPianoCEtico(processed: ProcessedConclusion[]): PianoCEticoAnalysis | undefined {
  const deontological = toNumberRecord(processed.map((entry) => [entry.annotation.conclusion, getEticoOutput(entry)?.allineamento_legale] as const))
  const consequentialist = toNumberRecord(processed.map((entry) => [entry.annotation.conclusion, getEticoOutput(entry)?.magnitudine_beneficio] as const))
  const virtue_ethics = toNumberRecord(processed.map((entry) => [entry.annotation.conclusion, getEticoOutput(entry)?.valore_empatico] as const))

  return deontological || consequentialist || virtue_ethics
    ? { deontological, consequentialist, virtue_ethics }
    : undefined
}

export function mapProcessedConclusionsToEpistemicAnalysis(processed: ProcessedConclusion[]): EpistemicAnalysis | undefined {
  if (processed.length === 0) {
    return undefined
  }

  const piano_a = toStringRecord(processed.map(({ annotation }) => [annotation.conclusion, annotation.state.pianoA] as const))
  const piano_b = toNumberRecord(processed.map(({ annotation }) => [annotation.conclusion, annotation.state.pianoB.probabile] as const))
  const etico = createPianoCEtico(processed)
  const morale = toObjectRecord(processed.map((entry) => [entry.annotation.conclusion, getMoraleOutput(entry)] as const))
  const pragmatico = toObjectRecord(processed.map((entry) => [entry.annotation.conclusion, getPragmaticoOutput(entry)] as const))
  const piano_c = etico || morale || pragmatico
    ? { etico, morale, pragmatico }
    : undefined
  const piano_d = createPianoD(processed)

  if (!piano_a && !piano_b && !piano_c && !piano_d) {
    return undefined
  }

  return {
    ...(piano_a ? { piano_a } : {}),
    ...(piano_b ? { piano_b } : {}),
    ...(piano_c ? { piano_c } : {}),
    ...(piano_d ? { piano_d } : {}),
  }
}
