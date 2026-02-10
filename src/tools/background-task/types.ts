export interface BackgroundTaskArgs {
  description: string
  prompt: string
  agent: string
}

export interface BackgroundOutputArgs {
  task_id: string
  block?: boolean
  timeout?: number
  full_session?: boolean
  include_thinking?: boolean
  message_limit?: number
  since_message_id?: string
  include_tool_results?: boolean
  thinking_max_chars?: number
}

export interface BackgroundCancelArgs {
  taskId?: string
  all?: boolean
}
