export interface ReasonArgueArgs {
  theory: {
    premises: Array<{ formula: string; kind?: string }>
    strict_rules?: Array<{ id: string; antecedents: string[]; consequent: string }>
    defeasible_rules?: Array<{ id: string; name?: string; antecedents: string[]; consequent: string }>
    preferences?: Array<{ superior: string; inferior: string }>
    classical_negation?: boolean
  }
  semantics?: "grounded" | "preferred" | "stable" | "complete"
}

export interface ReasonSolveArgs {
  description: string
  variables: Array<{ name: string; domain: number[] }>
  theory: Record<string, unknown>
  max_iterations: number
  initial_constraints?: unknown[]
  incremental_constraints?: unknown[]
}
