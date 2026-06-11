import type { JsonValue } from "./host-config"

export type HostSessionId = string

export type HostMessageContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType?: string; data?: string; url?: string }
  | { type: "json"; value: JsonValue }

export type HostSessionMessage = {
  role: "system" | "user" | "assistant" | "tool" | "custom"
  content: readonly HostMessageContent[]
  id?: string
  name?: string
  metadata?: JsonValue
}

export type HostContextUsage = {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export type HostSessionActions = {
  sendUserMessage(content: string | readonly HostMessageContent[], options?: HostSendMessageOptions): Promise<void>
  sendInternalMessage(message: HostSessionMessage, options?: HostSendMessageOptions): Promise<void>
  appendEntry(customType: string, data?: JsonValue): Promise<void>
  getSessionName(): string | undefined
  setSessionName(name: string): Promise<void>
  getContextUsage(): HostContextUsage | undefined
  compact(options?: HostCompactionOptions): Promise<void>
  abort(): void
  isIdle(): boolean
  hasPendingMessages(): boolean
}

export type HostSendMessageOptions = {
  deliverAs?: "steer" | "follow-up" | "next-turn"
  triggerTurn?: boolean
}

export type HostCompactionOptions = {
  instructions?: string
  preserveData?: Record<string, JsonValue>
}

export type HostSessionContext = {
  id: HostSessionId
  cwd: string
  modelId?: string
  providerId?: string
  actions: HostSessionActions
}
