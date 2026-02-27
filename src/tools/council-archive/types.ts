export interface CouncilFinalizeArgs {
  task_ids: string[]
  name: string
}

export interface CouncilMemberResult {
  task_id: string
  member: string
  has_response: boolean
  response_complete?: boolean
  result?: string
  result_truncated?: boolean
  archive_file?: string
  error?: string
}

export interface CouncilFinalizeResult {
  archive_dir: string
  meta_file: string
  members: CouncilMemberResult[]
}
