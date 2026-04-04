import { z } from "zod"

export const OpenClawGatewaySchema = z.object({
  type: z.enum(["http", "command"]).default("http"),
  // HTTP specific
  url: z.string().optional(),
  method: z.string().default("POST"),
  headers: z.record(z.string(), z.string()).optional(),
  // Command specific
  command: z.string().optional(),
  // Shared
  timeout: z.number().optional(),
})

export const OpenClawHookSchema = z.object({
  enabled: z.boolean().default(true),
  gateway: z.string(),
  instruction: z.string(),
})

export const OpenClawReplyListenerConfigSchema = z.object({
  discordBotToken: z.string().optional(),
  discordChannelId: z.string().optional(),
  discordMention: z.string().optional(), // For allowed_mentions
  authorizedDiscordUserIds: z.array(z.string()).default([]),

  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),

  pollIntervalMs: z.number().default(3000),
  rateLimitPerMinute: z.number().default(10),
  maxMessageLength: z.number().default(500),
  includePrefix: z.boolean().default(true),
})

export const OpenClawConfigSchema = z.object({
  enabled: z.boolean().default(false),

  // Outbound Configuration
  gateways: z.record(z.string(), OpenClawGatewaySchema).default({}),
  hooks: z.record(z.string(), OpenClawHookSchema).default({}),

  // Inbound Configuration (Reply Listener)
  replyListener: OpenClawReplyListenerConfigSchema.optional(),
})

export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>
export type OpenClawGateway = z.infer<typeof OpenClawGatewaySchema>
export type OpenClawHook = z.infer<typeof OpenClawHookSchema>
export type OpenClawReplyListenerConfig = z.infer<typeof OpenClawReplyListenerConfigSchema>
