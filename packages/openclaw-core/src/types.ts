export type OpenClawGateway = {
  readonly type?: "http" | "command"
  readonly url?: string
  readonly method?: string
  readonly headers?: Record<string, string>
  readonly command?: string
  readonly timeout?: number
}

export type OpenClawHook = {
  readonly enabled?: boolean
  readonly gateway: string
  readonly instruction: string
}

export type OpenClawReplyListenerConfig = {
  readonly discordBotToken?: string
  readonly discordChannelId?: string
  readonly discordMention?: string
  readonly authorizedDiscordUserIds?: readonly string[]
  readonly telegramBotToken?: string
  readonly telegramChatId?: string
  readonly pollIntervalMs?: number
  readonly rateLimitPerMinute?: number
  readonly maxMessageLength?: number
  readonly includePrefix?: boolean
}

export type OpenClawConfig = {
  readonly enabled: boolean
  readonly gateways: Record<string, OpenClawGateway>
  readonly hooks: Record<string, OpenClawHook>
  readonly replyListener?: OpenClawReplyListenerConfig
}

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
  messageId?: string
  platform?: string
  channelId?: string
  threadId?: string
}
