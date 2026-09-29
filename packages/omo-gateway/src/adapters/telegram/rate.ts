import type { Clock } from "./api"

export type TelegramLimits = {
  /** minimum gap between two messages in one chat; Telegram asks for at most 1 per second */
  perChatIntervalMs: number
  /** messages per minute in one group or supergroup; Telegram allows about 20 */
  perGroupPerMinute: number
}

export const TELEGRAM_LIMITS: TelegramLimits = { perChatIntervalMs: 1000, perGroupPerMinute: 20 }

const MINUTE = 60_000

/** Group, supergroup and channel ids are negative; private chats are positive. */
export function isGroupChat(chatId: string): boolean {
  return chatId.startsWith("-")
}

/**
 * Per-chat pacing for messages the bot sends: one per `perChatIntervalMs` in every chat and
 * `perGroupPerMinute` in a sliding minute for groups. Sends to one chat are serialized, so two
 * concurrent posts can never both take the same slot.
 */
export class TelegramRateLimiter {
  private readonly lastSend = new Map<string, number>()
  private readonly groupWindow = new Map<string, number[]>()
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly clock: Clock,
    private readonly limits: TelegramLimits = TELEGRAM_LIMITS,
  ) {}

  schedule<T>(chatId: string, send: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(chatId) ?? Promise.resolve()
    const run = previous.then(async () => {
      await this.waitForSlot(chatId)
      return send()
    })
    this.queues.set(
      chatId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  private waitMs(chatId: string, now: number): number {
    const last = this.lastSend.get(chatId)
    let wait = last === undefined ? 0 : last + this.limits.perChatIntervalMs - now
    if (isGroupChat(chatId)) {
      const recent = (this.groupWindow.get(chatId) ?? []).filter((at) => at > now - MINUTE)
      this.groupWindow.set(chatId, recent)
      const oldest = recent[0]
      if (recent.length >= this.limits.perGroupPerMinute && oldest !== undefined) wait = Math.max(wait, oldest + MINUTE - now)
    }
    return Math.max(0, wait)
  }

  private async waitForSlot(chatId: string): Promise<void> {
    for (let wait = this.waitMs(chatId, this.clock.now()); wait > 0; wait = this.waitMs(chatId, this.clock.now())) {
      await this.clock.sleep(wait)
    }
    const now = this.clock.now()
    this.lastSend.set(chatId, now)
    if (isGroupChat(chatId)) this.groupWindow.set(chatId, [...(this.groupWindow.get(chatId) ?? []), now])
  }
}
