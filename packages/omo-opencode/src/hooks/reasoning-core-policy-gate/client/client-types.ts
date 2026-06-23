export interface ReasoningCoreVariableDefinition {
  name: string
  domain: number[]
}

export interface ReasoningCoreConstraintRequest {
  variables?: ReasoningCoreVariableDefinition[]
  constraint?: Record<string, unknown>
  question?: string
}

export interface ReasoningCoreConstraintState {
  domains: Record<string, number[]>
  solved: boolean
  solved_count: number
  total_count: number
}

export interface ReasoningCoreKbQuery {
  content_type: "strict_rule" | "defeasible_rule" | "preference" | "premise" | "template" | "insight"
  keyword: string
  layer: "Core" | "Domain" | "Session" | "Learned"
  similarity_query: string
  tags: string[]
}

export interface ReasoningCoreKbQueryResult {
  count: number
  entries: Array<Record<string, unknown>>
}

export interface ReasoningCoreKbAddEntry {
  layer: "Core" | "Domain" | "Session" | "Learned"
  content: Record<string, unknown>
  tags: string[]
}

export interface ReasoningCoreKbAddResult {
  id: string
}

export interface ReasoningCoreKbRemoveEntry {
  id: string
}

export interface ReasoningCoreSolveProblem {
  description: string
  variables: ReasoningCoreVariableDefinition[]
  initial_constraints: Array<{ constraint: Record<string, unknown>; question?: string }>
  incremental_constraints?: Array<{ constraint: Record<string, unknown>; question?: string }>
  max_iterations: number
  theory: {
    premises: Array<{ formula: string; kind?: string }>
    strict_rules: Array<{ id: string; antecedents: string[]; consequent: string }>
    defeasible_rules: Array<{ id: string; name?: string; antecedents: string[]; consequent: string }>
    contrariness?: Array<{ target: string; attacker: string; relation: string }>
    preferences: Array<{ superior: string; inferior: string }>
    classical_negation: boolean
  }
}

export interface ReasonArgueRequest {
  theory: {
    premises: Array<{ formula: string; kind?: string }>
    strict_rules?: Array<{ id: string; antecedents: string[]; consequent: string }>
    defeasible_rules?: Array<{ id: string; name?: string; antecedents: string[]; consequent: string }>
    contrariness?: Array<{ target: string; attacker: string; relation: string }>
    preferences?: Array<{ superior: string; inferior: string }>
    classical_negation?: boolean
  }
  semantics?: "grounded" | "preferred" | "stable" | "complete"
}

export interface ReasoningCoreSolveOutcome {
  stop_signal: string
  argumentation_result?: {
    conclusions?: Record<string, {
      status?: string
      proof_chain?: Array<{ conclusion: string; from: string[]; rule_id: string | null; rule_kind: string }>
    }>
  }
  constraint_state: ReasoningCoreConstraintState
  iterations_used: number
  reasoning_trace: Array<Record<string, unknown>>
}

export interface ReasoningCoreMetacognitiveState {
  iteration: number
  domain_reduction_rate: number
  domains_solved: number
  domains_total: number
  extensions_count: number
}

export interface ReasoningCoreMetacognitiveVerdict {
  signal: string
  iteration: number
  reason: string
}

export interface ReasoningCoreMetacognitiveStatus {
  session_active: boolean
  domains: Record<string, number[]>
  is_solved: boolean
  reasoning_history: Array<Record<string, unknown>>
}
