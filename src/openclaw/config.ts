import type {
  OpenClawConfig,
  OpenClawGateway,
  OpenClawReplyListenerConfig,
} from "./types"

const DEFAULT_REPLY_POLL_INTERVAL_MS = 3000
const MIN_REPLY_POLL_INTERVAL_MS = 500
const MAX_REPLY_POLL_INTERVAL_MS = 60000
const DEFAULT_REPLY_RATE_LIMIT_PER_MINUTE = 10
const MIN_REPLY_RATE_LIMIT_PER_MINUTE = 1
const DEFAULT_REPLY_MAX_MESSAGE_LENGTH = 500
const MIN_REPLY_MAX_MESSAGE_LENGTH = 1
const MAX_REPLY_MAX_MESSAGE_LENGTH = 4000

function normalizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max?: number,
): number {
  const numeric =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN

  if (!Number.isFinite(numeric)) return fallback
  if (numeric < min) return min
  if (max !== undefined && numeric > max) return max
  return numeric
}

export function normalizeReplyListenerConfig(config: OpenClawConfig): OpenClawConfig {
  const replyListener = config.replyListener
  if (!replyListener) return config

  const normalizedReplyListener: OpenClawReplyListenerConfig = {
    ...replyListener,
    discordBotToken: replyListener.discordBotToken,
    discordChannelId: replyListener.discordChannelId,
    telegramBotToken: replyListener.telegramBotToken,
    telegramChatId: replyListener.telegramChatId,
    pollIntervalMs: normalizeInteger(
      replyListener.pollIntervalMs,
      DEFAULT_REPLY_POLL_INTERVAL_MS,
      MIN_REPLY_POLL_INTERVAL_MS,
      MAX_REPLY_POLL_INTERVAL_MS,
    ),
    rateLimitPerMinute: normalizeInteger(
      replyListener.rateLimitPerMinute,
      DEFAULT_REPLY_RATE_LIMIT_PER_MINUTE,
      MIN_REPLY_RATE_LIMIT_PER_MINUTE,
    ),
    maxMessageLength: normalizeInteger(
      replyListener.maxMessageLength,
      DEFAULT_REPLY_MAX_MESSAGE_LENGTH,
      MIN_REPLY_MAX_MESSAGE_LENGTH,
      MAX_REPLY_MAX_MESSAGE_LENGTH,
    ),
    includePrefix: replyListener.includePrefix !== false,
    authorizedDiscordUserIds: Array.isArray(replyListener.authorizedDiscordUserIds)
      ? replyListener.authorizedDiscordUserIds.filter(
          (id) => typeof id === "string" && id.trim() !== "",
        )
      : [],
  }

  return {
    ...config,
    replyListener: normalizedReplyListener,
  }
}

export function resolveGateway(
  config: OpenClawConfig,
  event: string,
): { gatewayName: string; gateway: OpenClawGateway; instruction: string } | null {
  if (!config.enabled) return null

  const mapping = config.hooks[event]
  if (!mapping || !mapping.enabled) {
    return null
  }

  const gateway = config.gateways[mapping.gateway]
  if (!gateway) {
    return null
  }

  if (gateway.type === "command") {
    if (!gateway.command) return null
  } else {
    if (!gateway.url) return null
  }

  return { gatewayName: mapping.gateway, gateway, instruction: mapping.instruction }
}

export function validateGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") return true
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname === "[::1]")
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}
