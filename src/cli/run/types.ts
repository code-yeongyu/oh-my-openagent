import type { OpencodeClient } from "@opencode-ai/sdk"

export interface RunOptions {
  message: string
  agent?: string
  directory?: string
  timeout?: number
}

export interface RunContext {
  client: OpencodeClient
  sessionID: string
  directory: string
  abortController: AbortController
}

export interface Todo {
  id: string
  content: string
  status: string
  priority: string
}

export interface SessionStatus {
  type: "idle" | "busy" | "retry"
}

export interface ChildSession {
  id: string
}

export interface EventPayload {
  type: string
  properties?: Record<string, unknown>
}

export interface SessionIdleProps {
  sessionID?: string
}

export interface SessionStatusProps {
  sessionID?: string
  status?: { type?: string }
}

export interface MessageUpdatedProps {
  info?: { sessionID?: string; role?: string }
  content?: string
}
