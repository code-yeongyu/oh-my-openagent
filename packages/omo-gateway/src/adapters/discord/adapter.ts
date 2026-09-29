import type { Capabilities, InboundEvent, RenderedOp, SendResult, SurfaceAdapter, SurfaceKey } from "../../adapter/contract"
import { createTranscriber, type Transcriber } from "../../stt/transcribe"
import { ChannelDirectory } from "./channels"
import { realClock, type DiscordClock } from "./clock"
import { DiscordGateway, webSocketFactory, type SocketFactory } from "./gateway"
import { DiscordInbound, targetChannel } from "./inbound"
import { DiscordOutbound } from "./outbound"
import { ChannelBucket, DiscordRest } from "./rest"

export type DiscordAdapterOptions = {
  /** the bot's user id: `SurfaceKey.account_id`, and how the adapter recognizes its own posts and mentions */
  account_id: string
  /** a bot token; sent only as `Authorization: Bot <token>` and in the gateway identify/resume */
  token: string
  /** channel ids catchUp and gap recovery read history from (owned chats, DM channels) */
  chats?: readonly string[]
  /** the guild `create_chat` creates channels in; without it `chat_create` is false */
  guild_id?: string
  apiBase?: string
  gatewayUrl?: string
  fetch?: typeof fetch
  socket?: SocketFactory
  clock?: DiscordClock
  transcriber?: Transcriber
  log?: (line: string) => void
  backoff?: { minMs: number; maxMs: number }
  /** how many recent event ids listen remembers to drop replays */
  recentIds?: number
}

class RecentIds {
  private readonly ids = new Set<string>()
  constructor(private readonly limit: number) {}

  add(id: string): boolean {
    if (this.ids.has(id)) return false
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const oldest = this.ids.values().next()
      if (oldest.done !== true) this.ids.delete(oldest.value)
    }
    return true
  }
}

export class DiscordAdapter implements SurfaceAdapter {
  readonly platform = "discord" as const
  private readonly options: DiscordAdapterOptions
  private readonly clock: DiscordClock
  private readonly log: (line: string) => void
  private readonly inbound: DiscordInbound
  private readonly outbound: DiscordOutbound
  private readonly caps: Capabilities

  constructor(options: DiscordAdapterOptions) {
    this.options = options
    this.clock = options.clock ?? realClock
    this.log = options.log ?? ((line) => console.warn(line))
    const fetcher = options.fetch ?? fetch
    const rest = new DiscordRest({ token: options.token, apiBase: options.apiBase ?? "https://discord.com/api/v10", fetch: fetcher, clock: this.clock })
    const channels = new ChannelDirectory(rest, this.log)
    this.caps = {
      edit: true,
      reactions: true,
      typing: true,
      threads: true,
      thread_archive: true,
      buttons: false,
      streaming: false,
      draft_stream: false,
      uploads: true,
      rich_links: true,
      presence: true,
      chat_create: options.guild_id !== undefined,
      max_text: 2000,
    }
    const transcriber = options.transcriber ?? createTranscriber({ stt: undefined, log: this.log })
    this.inbound = new DiscordInbound({ account_id: options.account_id, rest, channels, clock: this.clock, transcriber, fetch: fetcher, log: this.log })
    this.outbound = new DiscordOutbound({
      account_id: options.account_id,
      guild_id: options.guild_id ?? null,
      rest,
      bucket: new ChannelBucket(this.clock),
      channels,
      capabilities: this.caps,
    })
  }

  capabilities(): Capabilities {
    return { ...this.caps }
  }

  async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    if (signal.aborted) return
    const recent = new RecentIds(this.options.recentIds ?? 4096)
    let queue = Promise.resolve()
    let first = true
    let lastAt = this.clock.now()
    const emit = (event: InboundEvent | null) => {
      if (event === null || !recent.add(event.event_id)) return
      lastAt = Math.max(lastAt, Date.parse(event.at))
      onEvent(event)
    }
    const enqueue = (step: () => Promise<void> | void) => {
      queue = queue.then(step).catch((error: unknown) => this.log(`discord adapter: ${error instanceof Error ? error.message : String(error)}`))
    }
    const recoverGap = async (sinceMs: number) => {
      for (const channel of new Set([...(this.options.chats ?? []), ...this.inbound.watchedChannels()])) {
        for await (const event of this.inbound.history(channel, sinceMs)) emit(event)
      }
    }
    const gateway = new DiscordGateway(
      {
        token: this.options.token,
        url: this.options.gatewayUrl ?? "wss://gateway.discord.gg",
        clock: this.clock,
        socket: this.options.socket ?? webSocketFactory,
        log: this.log,
        backoff: this.options.backoff ?? { minMs: 1000, maxMs: 60_000 },
      },
      {
        dispatch: (type, data) => enqueue(async () => emit(await this.inbound.dispatch(type, data))),
        connected: (how) => {
          if (first) {
            first = false
            enqueue(ready)
          } else if (how === "identified") {
            const since = lastAt
            enqueue(() => recoverGap(since))
          }
        },
      },
    )
    try {
      await gateway.run(signal)
    } finally {
      await queue
    }
  }

  async *catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    const sinceMs = Date.parse(since)
    const channels = new Set([...(this.options.chats ?? []), ...threads.map(targetChannel)])
    for (const channel of channels) yield* this.inbound.history(channel, Number.isNaN(sinceMs) ? 0 : sinceMs)
  }

  send(op: RenderedOp): Promise<SendResult> {
    return this.outbound.send(op)
  }
}
