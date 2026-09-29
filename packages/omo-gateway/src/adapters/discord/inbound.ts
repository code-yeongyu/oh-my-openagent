import type { InboundEvent, SurfaceKey } from "../../adapter/contract"
import type { Transcriber, TranscribeResult } from "../../stt/transcribe"
import type { ChannelDirectory } from "./channels"
import type { DiscordClock } from "./clock"
import { messageEvent, reactionEvent, type EventContext } from "./events"
import type { DiscordRest } from "./rest"
import { compareSnowflakes, isJson, parseChannel, parseChannels, parseMessage, parseReaction, snowflakeAfter, type DiscordAttachment } from "./wire"

const PAGE = 100

export type InboundOptions = {
  account_id: string
  rest: DiscordRest
  channels: ChannelDirectory
  clock: DiscordClock
  transcriber: Transcriber
  fetch: typeof fetch
  log: (line: string) => void
}

export class DiscordInbound {
  readonly context: EventContext
  private readonly watched = new Set<string>()

  constructor(private readonly options: InboundOptions) {
    this.context = {
      account_id: options.account_id,
      channel: (id) => options.channels.get(id),
      transcribe: (attachment) => this.transcribe(attachment),
    }
  }

  /** Channel ids (chats and threads) events arrived from, for gap recovery after a re-identify. */
  watchedChannels(): readonly string[] {
    return [...this.watched]
  }

  async dispatch(type: string, data: unknown): Promise<InboundEvent | null> {
    const { channels, log } = this.options
    switch (type) {
      case "GUILD_CREATE":
        if (!isJson(data)) return null
        channels.rememberAll([...parseChannels(data.channels), ...parseChannels(data.threads)], typeof data.id === "string" ? data.id : null)
        return null
      case "THREAD_LIST_SYNC":
        if (isJson(data)) channels.rememberAll(parseChannels(data.threads), typeof data.guild_id === "string" ? data.guild_id : null)
        return null
      case "THREAD_CREATE":
      case "THREAD_UPDATE":
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE":
        channels.remember(parseChannel(data))
        return null
      case "MESSAGE_CREATE": {
        const message = parseMessage(data)
        if (message === null) {
          log("discord adapter: dropped a malformed MESSAGE_CREATE")
          return null
        }
        channels.remember(message.thread)
        return this.track(await messageEvent(this.context, message))
      }
      case "MESSAGE_REACTION_ADD": {
        const reaction = parseReaction(data)
        if (reaction === null) {
          log("discord adapter: dropped a malformed MESSAGE_REACTION_ADD")
          return null
        }
        return this.track(await reactionEvent(this.context, reaction, new Date(this.options.clock.now()).toISOString()))
      }
      default:
        return null
    }
  }

  /** Every message in `channel_id` created at or after `sinceMs`, oldest first, via `GET /channels/{id}/messages?after=`. */
  async *history(channel_id: string, sinceMs: number): AsyncIterable<InboundEvent> {
    let after = snowflakeAfter(sinceMs)
    for (;;) {
      let body: unknown
      try {
        body = await this.options.rest.request("GET", `/channels/${channel_id}/messages?after=${after}&limit=${PAGE}`)
      } catch (error) {
        this.options.log(`discord adapter: catchUp skipped channel ${channel_id}: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const page = (Array.isArray(body) ? body : []).flatMap((raw) => parseMessage(raw) ?? []).sort((a, b) => compareSnowflakes(a.id, b.id))
      for (const message of page) {
        const event = await messageEvent(this.context, message)
        if (event !== null) yield event
      }
      const last = page.at(-1)
      if (last === undefined || page.length < PAGE) return
      after = last.id
    }
  }

  private track(event: InboundEvent | null): InboundEvent | null {
    if (event !== null) this.watched.add(targetChannel(event.key))
    return event
  }

  private async transcribe(attachment: DiscordAttachment): Promise<TranscribeResult> {
    try {
      const response = await this.options.fetch(attachment.url)
      if (!response.ok) return { unavailable: `voice attachment download returned ${response.status}` }
      return await this.options.transcriber(new Uint8Array(await response.arrayBuffer()), attachment.filename)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.options.log(`discord adapter: voice attachment download failed: ${reason}`)
      return { unavailable: reason }
    }
  }
}

export function targetChannel(key: SurfaceKey): string {
  return key.thread_id ?? key.chat_id
}
