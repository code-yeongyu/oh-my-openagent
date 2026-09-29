import type { InboundEvent, SurfaceKey } from "../../adapter/contract"
import type { Transcriber, TranscribeResult } from "../../stt/transcribe"
import type { SlackApi } from "./api"
import type { SlackDirectory } from "./directory"
import { editEvent, messageEvent, reactionEvent, type EventContext } from "./events"
import type { SlackHistory } from "./history"
import { isoToTs, parseChanged, parseMessage, parseReaction, type Json, type SlackFile, type SlackMessage } from "./wire"

export type InboundOptions = {
  account_id: string
  api: SlackApi
  directory: SlackDirectory
  history: SlackHistory
  transcriber: Transcriber
  log: (line: string) => void
  chats: readonly string[] | null
}

const threadOf = (message: SlackMessage): string | null => (message.thread_ts !== null && message.thread_ts !== message.ts ? message.thread_ts : null)

export class SlackInbound {
  constructor(private readonly options: InboundOptions) {}

  private async context(): Promise<EventContext> {
    const { directory, account_id } = this.options
    return {
      account_id,
      self: await directory.self(),
      author: (speaker) => directory.author(speaker),
      transcribe: (file) => this.transcribe(file),
      threadOf: (channel, ts) => directory.threadOf(channel, ts),
    }
  }

  private async transcribe(file: SlackFile): Promise<TranscribeResult> {
    if (file.url === "") return { unavailable: "voice clip has no download url" }
    try {
      return await this.options.transcriber(await this.options.api.download(file.url), file.name)
    } catch (error) {
      const reason = this.options.api.redact(error instanceof Error ? error.message : String(error))
      this.options.log(`slack voice clip ${file.id}: ${reason}`)
      return { unavailable: reason }
    }
  }

  private message(context: EventContext, message: SlackMessage): Promise<InboundEvent | null> {
    this.options.directory.rememberMessage(message.channel, message.ts, threadOf(message))
    return messageEvent(context, message)
  }

  async realtime(type: string, data: Json): Promise<InboundEvent | null> {
    const context = await this.context()
    const { log } = this.options
    switch (type) {
      case "message":
      case "app_mention": {
        if (data.subtype === "message_changed") {
          const changed = parseChanged(data)
          if (changed === null) log("slack adapter: dropped a malformed message_changed")
          return changed === null ? null : editEvent(context, changed)
        }
        const message = parseMessage(data)
        if (message === null) log(`slack adapter: dropped a malformed ${type} event`)
        return message === null ? null : this.message(context, message)
      }
      case "reaction_added": {
        const reaction = parseReaction(data)
        if (reaction === null) log("slack adapter: dropped a malformed reaction_added")
        return reaction === null ? null : reactionEvent(context, reaction)
      }
      default:
        return null
    }
  }

  async *catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    const { history, directory } = this.options
    const context = await this.context()
    const oldest = isoToTs(since)
    const seen = new Set<string>()
    const fresh = async (message: SlackMessage): Promise<InboundEvent | null> => {
      const event = await this.message(context, message)
      if (event === null || seen.has(event.event_id)) return null
      seen.add(event.event_id)
      return event
    }
    for (const channel of this.options.chats ?? (await history.conversations())) {
      for (const message of await history.channel(channel, oldest)) {
        const event = await fresh(message)
        if (event !== null) yield event
      }
    }
    for (const message of await history.mentions(context.self.user_id, oldest)) {
      const event = await fresh(message)
      if (event !== null) yield event
    }
    const bound = threads.flatMap((key) => (key.platform === "slack" && key.thread_id !== null ? [{ chat_id: key.chat_id, thread_id: key.thread_id }] : []))
    const unique = new Map([...bound, ...directory.ownThreadKeys()].map((entry) => [`${entry.chat_id}:${entry.thread_id}`, entry]))
    for (const { chat_id, thread_id } of unique.values()) {
      for (const message of await history.thread(chat_id, thread_id, oldest)) {
        const event = await fresh(message)
        if (event !== null) yield event
      }
    }
  }
}
