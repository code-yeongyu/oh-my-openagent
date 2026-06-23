export type HypothesisStatus =
  | "active"
  | "confirmed"
  | "refuted"
  | "parked"
  | "superseded"
  | "resurrected"
export type EvidenceVerdict = "supports" | "refutes" | "inconclusive"
export type IdentityStatus = "active" | "quarantined" | "exhausted"
export type CircuitState = "closed" | "open" | "half_open"
export type IdentityKind = "api_key" | "session_token" | "proxy" | "http_endpoint"
export type AspicSemantics = "grounded" | "preferred" | "stable" | "complete"

export type Hypothesis = {
  id: string
  text: string
  falsifiability_criteria: string
  status: HypothesisStatus
  confidence: number
  uncertainty_label: string | null
  superseded_by: string | null
  resurrected_from: string | null
  aspic_theory_template: string | null
  created_at: number
  updated_at: number
}

export type ProbeSession = {
  id: string
  hypothesis_id: string | null
  identity_id: string | null
  experiment_id: string | null
  provider_id: string | null
  config: string | null
  started_at: number
  ended_at: number | null
}

export type ProbeExchange = {
  id: number
  session_id: string
  timestamp: number
  method: string
  url: string
  request_headers: string | null
  request_body: Buffer | string | null
  response_status: number | null
  response_headers: string | null
  response_body: Buffer | string | null
  timing_total_ms: number | null
  was_forwarded_as_is: number
}

export type Evidence = {
  id: number
  hypothesis_id: string
  session_id: string
  exchange_id: number | null
  verdict: EvidenceVerdict
  confidence: number | null
  reasoning: string | null
  aspic_preference_impact: string | null
  aspic_extensions_count: number | null
  kb_entry_id: string | null
  previous_evidence_id: number | null
  created_at: number
}

export type Identity = {
  id: string
  kind: IdentityKind
  label: string | null
  config: string
  provider_id: string | null
  tier: string
  status: IdentityStatus
  consecutive_failures: number
  total_uses: number
  last_used_at: number | null
  last_failure_at: number | null
  quarantined_until: number | null
  circuit_state: CircuitState
  created_at: number
  fingerprint_profile_id: string | null
}

export type NewHypothesisInput = {
  id: string
  text: string
  falsifiability_criteria: string
  aspic_theory_template?: unknown | null
}

export type NewExchangeInput = {
  session_id: string
  method: string
  url: string
  request_headers?: Record<string, string> | null
  request_body?: string | null
  response_status?: number | null
  response_headers?: Record<string, string> | null
  response_body?: string | null
  timing_total_ms?: number | null
  was_forwarded_as_is?: boolean
}

export type NewEvidenceInput = {
  hypothesis_id: string
  session_id: string
  exchange_id?: number | null
  verdict: EvidenceVerdict
  confidence?: number | null
  reasoning?: string | null
  aspic_preference_impact?: unknown | null
  aspic_extensions_count?: number | null
  kb_entry_id?: string | null
  previous_evidence_id?: number | null
}

export type NewIdentityInput = {
  id: string
  kind: IdentityKind
  label?: string | null
  provider_id?: string | null
  tier?: "canary" | "standard" | "premium" | "sacrificial"
  config: unknown
  status?: IdentityStatus
}

export type PoolHealth = {
  total: number
  active: number
  quarantined: number
  exhausted: number
  quarantined_ratio: number
}

export * from "./experiment-types"
export * from "./provider-types"
export * from "./fingerprint-types"
export * from "./pool-types"
export * from "./audit-log-types"
