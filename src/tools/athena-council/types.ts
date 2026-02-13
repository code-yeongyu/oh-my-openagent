export interface AthenaCouncilToolArgs {
  question: string
  members?: string[]
}

export interface AthenaCouncilLaunchedMember {
  task_id: string
  name: string
  model: string
  status: "running"
}

export interface AthenaCouncilFailedMember {
  name: string
  model: string
  error: string
}

export interface AthenaCouncilLaunchResult {
  launched: number
  members: AthenaCouncilLaunchedMember[]
  failed: AthenaCouncilFailedMember[]
}
