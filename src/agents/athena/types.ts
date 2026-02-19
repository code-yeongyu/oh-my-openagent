export interface CouncilMemberConfig {
  model: string
  variant?: string
  name?: string
}

export interface CouncilConfig {
  members: CouncilMemberConfig[]
}
