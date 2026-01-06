export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "error"
  | "cancelled"

export interface TaskProgress {
  toolCalls: number
  lastTool?: string
  lastUpdate: Date
  lastMessage?: string
  lastMessageAt?: Date
}

export interface BackgroundTask {
  id: string
  sessionID: string
  parentSessionID: string
  parentMessageID: string
  description: string
  prompt: string
  agent: string
  status: BackgroundTaskStatus
  startedAt: Date
  completedAt?: Date
  result?: string
  error?: string
  progress?: TaskProgress
  parentModel?: { providerID: string; modelID: string }
  model?: string
}

export interface LaunchInput {
  description: string
  prompt: string
  agent: string
  parentSessionID: string
  parentMessageID: string
  parentModel?: { providerID: string; modelID: string }
}
