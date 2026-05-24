export interface FileTaskState {
  id: string
  description: string
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked"
  createdAt: number
  updatedAt: number
  sessionId?: string
  blockingTaskId?: string
  result?: string
  error?: string
  wave?: number
  metadata: Record<string, unknown>
}

export interface FileTaskStateStore {
  load(): FileTaskState[]
  save(tasks: FileTaskState[]): void
  getTask(id: string): FileTaskState | null
  upsertTask(task: FileTaskState): void
  deleteTask(id: string): void
}
