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
  info?: {
    sessionID?: string
    role?: string
    modelID?: string
    providerID?: string
    agent?: string
  }
}

export interface MessagePartUpdatedProps {
  info?: { sessionID?: string; role?: string }
  part?: {
    type?: string
    text?: string
    name?: string
    input?: unknown
  }
}

export interface ToolExecuteProps {
  sessionID?: string
  name?: string
  input?: Record<string, unknown>
}

export interface ToolResultProps {
  sessionID?: string
  name?: string
  output?: string
}

export interface SessionErrorProps {
  sessionID?: string
  error?: unknown
}
