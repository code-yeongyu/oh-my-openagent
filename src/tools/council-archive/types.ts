export interface CouncilFinalizeArgs {
  task_ids: string[]
  name: string
  intent: string
  question?: string
  prompt_file?: string
}

export interface CouncilMemberResult {
  task_id: string
  member: string
  has_response: boolean
  response_complete?: boolean
  archive_file?: string
  error?: string
}

export interface CouncilFinalizeResult {
  archive_dir: string
  meta_file: string
  members: CouncilMemberResult[]
}
