export interface CouncilMemberConfig {
  model: string
  variant?: string
  name?: string
  temperature?: number
}

export interface CouncilConfig {
  members: CouncilMemberConfig[]
}
