export type DecisionLedgerStage1 = {
  questions: unknown
  answers: unknown
  probabilities?: unknown
  confidence?: number
  latencyMs: number
}

export type DecisionLedgerCandidate = {
  name: string
  priceLine: string
  strength: string
}

export type DecisionLedgerStage2 = {
  questions: unknown
  answers: unknown
  confidence?: number
  latencyMs: number
}

export type DecisionLedgerResolved = {
  path?: string
  effort?: number
  model?: string
  lane?: string
}

export type DecisionLedgerSource = "jev" | "fallback"

export type DecisionLedgerUsage = {
  inputTokens: number
  costUsd: number
}

export type DecisionLedgerEntry = {
  id: string
  ts: number
  session: string
  task: {
    description: string
    /** Caller truncates; the ledger also caps this at 2000 chars. */
    promptExcerpt: string
  }
  stage1?: DecisionLedgerStage1
  candidates?: DecisionLedgerCandidate[]
  stage2?: DecisionLedgerStage2
  resolved: DecisionLedgerResolved
  source: DecisionLedgerSource
  reason?: string
  usage: DecisionLedgerUsage
}

export type DecisionLedgerOutcomeStatus = "success" | "failure" | "timeout" | "overridden"

export type DecisionOutcome = {
  decisionId: string
  ts: number
  status: DecisionLedgerOutcomeStatus
  durationMs: number
  overrideReason?: string
  notes?: string
}

/** A ledger entry with its back-filled outcome, if any. */
export type DecisionLedgerEntryWithOutcome = DecisionLedgerEntry & {
  outcome?: DecisionOutcome
}

export const PROMPT_EXCERPT_CAP = 2000
