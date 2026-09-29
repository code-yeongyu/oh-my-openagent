import type { DiscordRest } from "./rest"
import { parseChannel, type DiscordChannel } from "./wire"

/**
 * What the adapter knows about channels: type, guild and thread parent. Filled from gateway events
 * (GUILD_CREATE, THREAD_CREATE, THREAD_LIST_SYNC, CHANNEL_CREATE, a message's `thread`) and, for a
 * channel it has not seen, from one `GET /channels/{id}`.
 */
export class ChannelDirectory {
  private readonly known = new Map<string, DiscordChannel>()
  private readonly pending = new Map<string, Promise<DiscordChannel | null>>()

  constructor(
    private readonly rest: DiscordRest,
    private readonly log: (line: string) => void,
  ) {}

  remember(channel: DiscordChannel | null): void {
    if (channel === null) return
    const previous = this.known.get(channel.id)
    this.known.set(channel.id, { ...channel, guild_id: channel.guild_id ?? previous?.guild_id ?? null, parent_id: channel.parent_id ?? previous?.parent_id ?? null })
  }

  rememberAll(channels: readonly DiscordChannel[], guild_id: string | null = null): void {
    for (const channel of channels) this.remember(guild_id === null ? channel : { ...channel, guild_id: channel.guild_id ?? guild_id })
  }

  get(id: string): Promise<DiscordChannel | null> {
    const cached = this.known.get(id)
    if (cached !== undefined) return Promise.resolve(cached)
    const inflight = this.pending.get(id)
    if (inflight !== undefined) return inflight
    const lookup = this.rest.request("GET", `/channels/${id}`).then(
      (body) => {
        const channel = parseChannel(body)
        this.remember(channel)
        return channel
      },
      (error: unknown) => {
        this.log(`discord adapter: cannot read channel ${id}: ${error instanceof Error ? error.message : String(error)}`)
        return null
      },
    )
    this.pending.set(id, lookup)
    return lookup.finally(() => this.pending.delete(id))
  }
}
