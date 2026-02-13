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

export interface CouncilLaunchFailure {
  member: CouncilMemberConfig
  error: string
}

export interface CouncilLaunchedMember {
  member: CouncilMemberConfig
  taskId: string
}

/** Return type of executeCouncil — only tracks launch outcomes, not task completion */
export interface CouncilLaunchResult {
  question: string
  launched: CouncilLaunchedMember[]
  failures: CouncilLaunchFailure[]
  totalMembers: number
}
