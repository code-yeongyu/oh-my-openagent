export interface EpistemicFactors {
  supporto_empirico: number
  compatibilita_strutturale: number
  potenziale_esplicativo: number
  valore_verifica: number
  maturita: number
}

export interface PragmaticFactors {
  beneficio_potenziale: number
  urgenza: number
  costo_verifica: number
  rischio: number
}

export interface HookFactors {
  epistemici: EpistemicFactors
  pragmatici: PragmaticFactors
}

export type HookStrength = "debole" | "medio" | "forte"

export type HookPolarity = "positivo" | "negativo"

export interface EpistemicHook {
  id: string
  target: string
  polarity: HookPolarity
  strength: HookStrength
  factors: HookFactors
  rationale: string
  timestamp: number
  sessionId: string
}

export interface HookBalance {
  target: string
  positiveCount: number
  negativeCount: number
  positiveStrengthSum: number
  negativeStrengthSum: number
  netForce: number
  direction: "retention" | "expulsion" | "neutral"
}

export const HOOK_STRENGTH_VALUES: Record<HookStrength, number> = {
  debole: 1,
  medio: 2,
  forte: 3,
}
