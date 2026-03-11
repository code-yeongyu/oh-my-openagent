import type { QuorumRules, RetryRules } from "../../agents/athena/types"

export interface AthenaCouncilToolArgs {
  prompt_file: string
  members?: string[]
}

export interface LaunchedMemberInfo {
  task_id: string
  session_id: string | undefined
  member_name: string
  model: string
}

export interface AthenaCouncilResult {
  result: string
  launched: LaunchedMemberInfo[]
  failures: Array<{ member_name: string; model: string; error: string }>
  total_requested: number
  retryRules: RetryRules
  quorumRules: QuorumRules
}
