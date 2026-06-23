export interface PreferenceVector {
  logico: number
  probabilistico: number
  etico?: number
  pragmatico?: number
  morale?: number
  combined: number
}

export interface RulePreference {
  superior: string
  inferior: string
  strength: number
}

export interface DampenedPreference {
  ruleId: string
  previous: number
  proposed: number
  applied: number
}

export interface PreferenceCycleState {
  cycleCount: number
  lastDirection: "up" | "down" | "none"
  oscillationCount: number
  frozen: boolean
}
