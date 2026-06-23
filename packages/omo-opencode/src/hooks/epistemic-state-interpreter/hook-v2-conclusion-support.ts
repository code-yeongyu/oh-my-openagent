import type { HookFactors, HookPolarity, HookStrength } from "./hook-entity-types"
import { analyzeTagSemantics } from "./tag-semantic-analyzer"
import type { MultiPlaneAnnotation } from "./multi-plane-types"
import type { AnalyzedProofChain } from "./v5-types"

export function createMinimalChain(): AnalyzedProofChain {
  return {
    ruleIds: [],
    antecedents: new Map(),
    depth: 0,
    hasCircularDependency: false,
    allPremisesOrdinary: null,
  }
}

export function toAnalyzedProofChain(value: unknown): AnalyzedProofChain {
  if (typeof value !== "object" || value === null || !("antecedents" in value)) {
    return createMinimalChain()
  }

  const chain = value as {
    antecedents: unknown
    ruleIds?: unknown
    depth?: unknown
    hasCircularDependency?: unknown
    allPremisesOrdinary?: unknown
  }
  const antecedents = chain.antecedents instanceof Map ? chain.antecedents : new Map<string, string[]>()

  return {
    ruleIds: Array.isArray(chain.ruleIds)
      ? chain.ruleIds.filter((ruleId): ruleId is string => typeof ruleId === "string")
      : [],
    antecedents,
    depth: typeof chain.depth === "number" ? chain.depth : 0,
    hasCircularDependency: chain.hasCircularDependency === true,
    allPremisesOrdinary:
      chain.allPremisesOrdinary === true || chain.allPremisesOrdinary === false
        ? chain.allPremisesOrdinary
        : null,
  }
}

export function getPremiseTags(chain: AnalyzedProofChain): string[] {
  return [...new Set([...chain.antecedents.values()].flat())]
}

export function getHookStrength(state: MultiPlaneAnnotation["rawClassification"]): HookStrength {
  switch (state) {
    case "plausibile":
    case "escluso":
      return "forte"
    case "da_verificare":
    case "escluso_operativamente":
      return "medio"
    default:
      return "debole"
  }
}

export function getHookPolarity(state: MultiPlaneAnnotation["rawClassification"]): HookPolarity {
  return state === "escluso" || state === "escluso_operativamente" ? "negativo" : "positivo"
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function createHookFactors(input: {
  logico: number
  probabilistico: number
  pianoBProbabile: number | null
  pianoCInconclusivo: boolean
  eticoScore: number
  pragmaticoScore: number
  blocked: boolean
  premiseTags?: string[]
}): HookFactors {
  const tagBonuses = input.premiseTags ? analyzeTagSemantics(input.premiseTags) : null
  return {
    epistemici: {
      supporto_empirico: clamp01(input.probabilistico + (tagBonuses?.supporto_empirico ?? 0)),
      compatibilita_strutturale: clamp01(input.logico + (tagBonuses?.compatibilita_strutturale ?? 0)),
      potenziale_esplicativo: clamp01((input.pianoBProbabile ?? 0) + (tagBonuses?.potenziale_esplicativo ?? 0)),
      valore_verifica: clamp01((input.pianoCInconclusivo ? 1 : 0.3) + (tagBonuses?.valore_verifica ?? 0)),
      maturita: clamp01((input.pianoBProbabile ?? 0) + (tagBonuses?.maturita ?? 0)),
    },
    pragmatici: {
      beneficio_potenziale: clamp01(input.pragmaticoScore + (tagBonuses?.beneficio_potenziale ?? 0)),
      urgenza: clamp01((input.blocked || input.pianoCInconclusivo ? 1 : 0.4) + (tagBonuses?.urgenza ?? 0)),
      costo_verifica: clamp01((input.pianoCInconclusivo ? 0.8 : 0.2) + (tagBonuses?.costo_verifica ?? 0)),
      rischio: clamp01((1 - input.eticoScore) + (tagBonuses?.rischio ?? 0)),
    },
  }
}
