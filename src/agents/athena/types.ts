export interface CouncilMemberConfig {
  model: string
  temperature?: number
  variant?: string
  name?: string
}

export interface CouncilConfig {
  members: CouncilMemberConfig[]
}

export interface AthenaConfig {
  model?: string
  council: CouncilConfig
}

export type CouncilMemberStatus = "completed" | "timeout" | "error"

export type AgreementLevel = "unanimous" | "majority" | "minority" | "solo"

export interface CouncilMemberResponse {
  member: CouncilMemberConfig
  status: CouncilMemberStatus
  response?: string
  error?: string
  taskId: string
  durationMs: number
}

export interface CouncilExecutionResult {
  question: string
  responses: CouncilMemberResponse[]
  totalMembers: number
  completedCount: number
  failedCount: number
}
