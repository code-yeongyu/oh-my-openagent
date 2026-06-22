import type { PluginInput } from "@opencode-ai/plugin"

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TodoPriority = "low" | "medium" | "high"

export interface TodoSnapshot {
  id: string
  content: string
  status: TodoStatus
  priority?: TodoPriority
}

export interface PlanFile {
  name: string
  path: string
  mtimeMs: number
}

export type TaskNotepadContext = Pick<PluginInput, "client" | "directory">
