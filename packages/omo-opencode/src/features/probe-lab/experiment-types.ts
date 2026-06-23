export type QuestionStatus = "open" | "answered" | "parked" | "superseded"
export type QuestionDomain = "llm_reverse" | "anti_bot" | "signup_automation" | "fingerprint" | "general"

export type Question = {
  id: string
  text: string
  domain: string
  status: QuestionStatus
  priority: number
  tags: string | null
  created_at: number
  updated_at: number
  answered_at: number | null
}

export type NewQuestionInput = {
  id: string
  text: string
  domain?: string
  priority?: number
  tags?: ReadonlyArray<string> | null
}

export type ExperimentStatus = "draft" | "running" | "completed" | "aborted" | "paused"

export type ExperimentProtocolStep = {
  step: number
  action: string
  params?: Record<string, unknown>
}

export type ExperimentSafetyBudget = {
  max_identities_burned: number
  max_time_s: number
  require_canary: boolean
}

export type Experiment = {
  id: string
  hypothesis_id: string
  question_id: string | null
  name: string
  description: string | null
  protocol: string
  status: ExperimentStatus
  expected_outcome: string | null
  safety_budget: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
}

export type NewExperimentInput = {
  id: string
  hypothesis_id: string
  question_id?: string | null
  name: string
  description?: string | null
  protocol: ReadonlyArray<ExperimentProtocolStep>
  expected_outcome?: string | null
  safety_budget?: ExperimentSafetyBudget | null
}
