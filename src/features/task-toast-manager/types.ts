export type TaskStatus = "running" | "queued" | "completed" | "error"

export interface TrackedTask {
  id: string
  description: string
  agent: string
  status: TaskStatus
  startedAt: Date
  isBackground: boolean
}

export interface TaskToastOptions {
  title: string
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration?: number
}
