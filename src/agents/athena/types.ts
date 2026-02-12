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
