import { lookupByMessageId } from "./session-registry"
import { injectReplyIntoPane, ReplyListenerRateLimiter } from "./reply-listener-injection"
import { logReplyListenerMessage } from "./reply-listener-log"
import { writeReplyListenerDaemonState, type ReplyListenerDaemonState } from "./reply-listener-state"
import type { OpenClawConfig } from "./types"

interface TelegramMessage {
  message_id?: number
  chat?: { id?: number | string }
  text?: string
  reply_to_message?: { message_id?: number }
}

interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
}

function parseTelegramUpdatesResponse(body: unknown): TelegramUpdate[] {
  if (typeof body !== "object" || body === null) return []
  const result = (body as { result?: TelegramUpdate[] }).result
  return Array.isArray(result) ? result : []
}

export async function pollTelegramReplies(
  config: OpenClawConfig,
  state: ReplyListenerDaemonState,
  rateLimiter: ReplyListenerRateLimiter,
): Promise<void> {
  const replyListener = config.replyListener
  if (!replyListener?.telegramBotToken || !replyListener.telegramChatId) return

  try {
    const offset = state.telegramLastUpdateId ? state.telegramLastUpdateId + 1 : 0
    const url = `https://api.telegram.org/bot${replyListener.telegramBotToken}/getUpdates?offset=${offset}&timeout=0`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(url, { method: "GET", signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      logReplyListenerMessage(`Telegram API error: HTTP ${response.status}`)
      return
    }

    const updates = parseTelegramUpdatesResponse(await response.json())
    for (const update of updates) {
      const message = update.message
      state.telegramLastUpdateId = update.update_id ?? state.telegramLastUpdateId
      writeReplyListenerDaemonState(state)

      if (!message?.reply_to_message?.message_id) continue
      if (String(message.chat?.id) !== replyListener.telegramChatId) continue
      if (!message.text) continue

      const mapping = lookupByMessageId("telegram", String(message.reply_to_message.message_id))
      if (!mapping) continue

      if (!rateLimiter.canProceed()) {
        logReplyListenerMessage(`WARN: Rate limit exceeded, dropping Telegram message ${message.message_id}`)
        state.errors += 1
        continue
      }

      const success = await injectReplyIntoPane(mapping.tmuxPaneId, message.text, "telegram", config)
      if (success) {
        state.messagesInjected += 1
        try {
          await fetch(`https://api.telegram.org/bot${replyListener.telegramBotToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: replyListener.telegramChatId,
              text: "Injected into Codex CLI session.",
              reply_to_message_id: message.message_id,
            }),
          })
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
    logReplyListenerMessage(`Telegram polling error: ${state.lastError}`)
  }
}
