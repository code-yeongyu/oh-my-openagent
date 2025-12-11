export interface BackgroundTaskArgs {
  description: string
  prompt: string
  agent: string
}

export interface BackgroundStatusArgs {
  taskId?: string
}

export interface BackgroundResultArgs {
  taskId: string
}

export interface BackgroundCancelArgs {
  taskId: string
}
