import type { QuorumRules } from "../../agents/athena"

export interface CouncilFinalizeArgs {
  task_ids: string[]
  name: string
  intent: string
  question?: string
  prompt_file?: string
  mode?: string
  quorum_rules?: QuorumRules
}

export interface CouncilMemberResult {
  task_id: string
  member: string
  has_response: boolean
  response_complete?: boolean
  archive_file?: string
  error?: string
}

export interface CouncilFinalizeQuorumStatus {
  met: boolean
  actual: number
  required: number
}

export interface CouncilFinalizeResult {
  success: boolean
  error?: string
  archive_dir: string
  meta_file: string
  members: CouncilMemberResult[]
  quorum: CouncilFinalizeQuorumStatus
}
