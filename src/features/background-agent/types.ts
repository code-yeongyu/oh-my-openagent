export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"

export interface TaskProgress {
  toolCalls: number
  lastTool?: string
  lastUpdate: Date
}

export interface BackgroundTask {
  id: string
  sessionID: string
  parentSessionID: string
  parentMessageID: string
  description: string
  agent: string
  status: BackgroundTaskStatus
  startedAt: Date
  completedAt?: Date
  result?: string
  error?: string
  progress?: TaskProgress
}

export interface LaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
}
