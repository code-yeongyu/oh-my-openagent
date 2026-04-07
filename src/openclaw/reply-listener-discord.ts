import { lookupByMessageId } from "./session-registry"
import { injectReplyIntoPane, ReplyListenerRateLimiter } from "./reply-listener-injection"
import { logReplyListenerMessage } from "./reply-listener-log"
import {
  recordSeenDiscordMessage,
  writeReplyListenerDaemonState,
  type ReplyListenerDaemonState,
} from "./reply-listener-state"
import type { OpenClawConfig } from "./types"

interface DiscordMessage {
  id: string
  content: string
  author: { id: string }
  message_reference?: { message_id?: string }
}

let discordBackoffUntil = 0

export async function pollDiscordReplies(
  config: OpenClawConfig,
  state: ReplyListenerDaemonState,
  rateLimiter: ReplyListenerRateLimiter,
): Promise<void> {
  const replyListener = config.replyListener
  if (!replyListener?.discordBotToken || !replyListener.discordChannelId) return
  if (!replyListener.authorizedDiscordUserIds || replyListener.authorizedDiscordUserIds.length === 0) {
    return
  }
  if (Date.now() < discordBackoffUntil) return

  try {
    const after = state.discordLastMessageId
      ? `?after=${state.discordLastMessageId}&limit=10`
      : "?limit=10"
    const url = `https://discord.com/api/v10/channels/${replyListener.discordChannelId}/messages${after}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bot ${replyListener.discordBotToken}` },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const remaining = response.headers.get("x-ratelimit-remaining")
    const reset = response.headers.get("x-ratelimit-reset")
    if (remaining !== null && Number.parseInt(remaining, 10) < 2) {
      const parsedReset = reset ? Number.parseFloat(reset) : Number.NaN
      const resetTime = Number.isFinite(parsedReset) ? parsedReset * 1000 : Date.now() + 10000
      discordBackoffUntil = resetTime
      logReplyListenerMessage(
        `WARN: Discord rate limit low (remaining: ${remaining}), backing off until ${new Date(resetTime).toISOString()}`,
      )
    }

    if (!response.ok) {
      state.errors += 1
      state.lastError = `Discord API error: HTTP ${response.status}`
      logReplyListenerMessage(state.lastError)
      writeReplyListenerDaemonState(state)
      return
    }

    const messages = await response.json()
    if (!Array.isArray(messages) || messages.length === 0) return

    for (const message of [...messages as DiscordMessage[]].reverse()) {
      recordSeenDiscordMessage(state, message.id)
      writeReplyListenerDaemonState(state)

      const replyToMessageId = message.message_reference?.message_id
      if (!replyToMessageId) continue
      if (!replyListener.authorizedDiscordUserIds.includes(message.author.id)) continue

      const mapping = lookupByMessageId("discord-bot", replyToMessageId)
      if (!mapping) continue

      if (!rateLimiter.canProceed()) {
        logReplyListenerMessage(`WARN: Rate limit exceeded, dropping Discord message ${message.id}`)
        state.errors += 1
        continue
      }

      const success = await injectReplyIntoPane(mapping.tmuxPaneId, message.content, "discord", config)
      if (success) {
        state.messagesInjected += 1
        try {
          await fetch(
            `https://discord.com/api/v10/channels/${replyListener.discordChannelId}/messages/${message.id}/reactions/%E2%9C%85/@me`,
            {
              method: "PUT",
              headers: { Authorization: `Bot ${replyListener.discordBotToken}` },
            },
          )
        } catch {
        }
      } else {
        state.errors += 1
      }

      writeReplyListenerDaemonState(state)
    }
  } catch (error) {
    state.errors += 1
    state.lastError = error instanceof Error ? error.message : String(error)
    logReplyListenerMessage(`Discord polling error: ${state.lastError}`)
  }
}
