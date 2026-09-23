import type { Plugin } from "@opencode/plugin"

export type V2Storage = Plugin.Context["storage"]

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface V2SessionRecord {
  id: string
  parentID?: string
  directory: string
  agent?: string
  createdAt: number
}

export interface V2TodoItem {
  id?: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: string
}

export type V2SessionStatus = "idle" | "busy" | "retry"
