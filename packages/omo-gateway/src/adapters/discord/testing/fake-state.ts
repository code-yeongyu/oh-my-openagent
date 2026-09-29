import { DISCORD_EPOCH } from "../wire"

export type FakeUser = { id: string; username: string; global_name: string | null; bot: boolean }
export type FakeChannel = { id: string; type: number; guild_id: string | null; parent_id: string | null; name: string; archived: boolean }
export type FakeAttachment = { id: string; filename: string; content_type: string; bytes: Uint8Array }
export type FakeMessage = {
  id: string
  channel_id: string
  author: FakeUser
  content: string
  timestamp: string
  flags: number
  mentions: string[]
  attachments: FakeAttachment[]
  reactions: Map<string, Set<string>>
  thread: string | null
}

export const FAKE_BOT: FakeUser = { id: "100000000000000001", username: "omo-test-bot", global_name: null, bot: true }
export const FAKE_ALICE: FakeUser = { id: "200000000000000001", username: "alice", global_name: "Alice", bot: false }
export const FAKE_GUILD = "300000000000000001"
export const FAKE_CHAT = "400000000000000001"
export const FAKE_DM = "400000000000000002"

export class FakeDiscordState {
  readonly channels = new Map<string, FakeChannel>()
  readonly messages = new Map<string, FakeMessage>()
  private lastMs = 0
  private increment = 0

  constructor() {
    this.channels.set(FAKE_CHAT, { id: FAKE_CHAT, type: 0, guild_id: FAKE_GUILD, parent_id: null, name: "gateway-qa", archived: false })
    this.channels.set(FAKE_DM, { id: FAKE_DM, type: 1, guild_id: null, parent_id: null, name: "", archived: false })
  }

  snowflake(): string {
    const ms = Math.max(Date.now(), this.lastMs)
    this.increment = ms === this.lastMs ? this.increment + 1 : 0
    this.lastMs = ms
    return String(((BigInt(ms) - DISCORD_EPOCH) << 22n) | BigInt(this.increment))
  }

  timeOf(id: string): string {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH)).toISOString()
  }

  addMessage(input: { channel_id: string; author: FakeUser; content: string; flags?: number; attachments?: FakeAttachment[] }): FakeMessage {
    const id = this.snowflake()
    const mentions = [...input.content.matchAll(/<@!?(\d+)>/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    const message: FakeMessage = {
      id,
      channel_id: input.channel_id,
      author: input.author,
      content: input.content,
      timestamp: this.timeOf(id),
      flags: input.flags ?? 0,
      mentions,
      attachments: input.attachments ?? [],
      reactions: new Map(),
      thread: null,
    }
    this.messages.set(id, message)
    return message
  }

  addChannel(input: Omit<FakeChannel, "id" | "archived">): FakeChannel {
    const channel: FakeChannel = { ...input, id: this.snowflake(), archived: false }
    this.channels.set(channel.id, channel)
    return channel
  }

  channelJson(channel: FakeChannel): Record<string, unknown> {
    const thread = channel.type >= 10 && channel.type <= 12
    return {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      ...(channel.guild_id === null ? {} : { guild_id: channel.guild_id }),
      ...(channel.parent_id === null ? {} : { parent_id: channel.parent_id }),
      ...(thread ? { thread_metadata: { archived: channel.archived, auto_archive_duration: 10080, locked: false } } : {}),
    }
  }

  messageJson(message: FakeMessage, origin: string, gateway: boolean): Record<string, unknown> {
    const guild_id = this.channels.get(message.channel_id)?.guild_id ?? null
    const thread = message.thread === null ? undefined : this.channels.get(message.thread)
    return {
      id: message.id,
      channel_id: message.channel_id,
      ...(gateway && guild_id !== null ? { guild_id } : {}),
      author: message.author,
      content: message.content,
      timestamp: message.timestamp,
      flags: message.flags,
      mentions: message.mentions.map((id) => ({ id, username: id === FAKE_BOT.id ? FAKE_BOT.username : id })),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        size: attachment.bytes.length,
        content_type: attachment.content_type,
        url: `${origin}/attachments/${message.id}/${attachment.id}/${encodeURIComponent(attachment.filename)}`,
      })),
      ...(thread === undefined ? {} : { thread: this.channelJson(thread) }),
    }
  }

  inChannel(channel_id: string): FakeMessage[] {
    return [...this.messages.values()].filter((message) => message.channel_id === channel_id)
  }
}
