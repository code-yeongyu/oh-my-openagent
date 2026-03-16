import type { OpenClawConfig, OpenClawGateway, OpenClawHook } from "../config/schema/openclaw"

export type { OpenClawConfig, OpenClawGateway, OpenClawHook }

export interface OpenClawContext {
  sessionId?: string
  projectPath?: string
  projectName?: string
  tmuxSession?: string
  prompt?: string
  contextSummary?: string
  reasoning?: string
  question?: string
  tmuxTail?: string
  replyChannel?: string
  replyTarget?: string
  replyThread?: string
  [key: string]: string | undefined
}

export interface OpenClawPayload {
  event: string
  instruction: string
  text: string
  timestamp: string
  sessionId?: string
  projectPath?: string
  projectName?: string
  tmuxSession?: string
  tmuxTail?: string
  channel?: string
  to?: string
  threadId?: string
  context: OpenClawContext
}

export interface WakeResult {
  gateway: string
  success: boolean
  error?: string
  statusCode?: number
}
