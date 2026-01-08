export interface BackgroundTaskArgs {
  description: string
  prompt: string
  agent: string
}

export interface BackgroundOutputArgs {
  task_id: string
  block?: boolean
  timeout?: number
}

export interface BackgroundCancelArgs {
  taskId?: string
  all?: boolean
}
