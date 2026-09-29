// Discord API payloads the adapter reads, parsed from unknown JSON. Anything malformed parses to
// null, so a bad frame or response is dropped with a log line instead of crashing the listener.

export type Json = Record<string, unknown>

export function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export type DiscordUser = { id: string; username: string; global_name: string | null; bot: boolean }
export type DiscordAttachment = { id: string; filename: string; url: string; content_type: string; size: number; voice: boolean }
export type DiscordMessage = {
  id: string
  channel_id: string
  guild_id: string | null
  author: DiscordUser
  content: string
  timestamp: string
  mentions: readonly string[]
  attachments: readonly DiscordAttachment[]
  referenced: { id: string; author: string; content: string } | null
  thread: DiscordChannel | null
}
export type DiscordChannel = { id: string; type: number; guild_id: string | null; parent_id: string | null; archived: boolean | null }
export type DiscordReaction = {
  user_id: string
  channel_id: string
  message_id: string
  guild_id: string | null
  emoji: { id: string | null; name: string | null }
  is_bot: boolean
  display: string
}

const VOICE_MESSAGE_FLAG = 1 << 13
const THREAD_TYPES = new Set([10, 11, 12])
const DM_TYPES = new Set([1, 3])

export const isThreadType = (type: number) => THREAD_TYPES.has(type)
export const isDmType = (type: number) => DM_TYPES.has(type)

export function parseUser(value: unknown): DiscordUser | null {
  if (!isJson(value)) return null
  const id = str(value.id)
  if (id === null) return null
  return { id, username: str(value.username) ?? id, global_name: str(value.global_name), bot: value.bot === true }
}

function parseAttachment(value: unknown, messageFlags: number): DiscordAttachment | null {
  if (!isJson(value)) return null
  const id = str(value.id)
  const url = str(value.url)
  if (id === null || url === null) return null
  return {
    id,
    url,
    filename: str(value.filename) ?? id,
    content_type: str(value.content_type) ?? "application/octet-stream",
    size: num(value.size) ?? 0,
    voice: (messageFlags & VOICE_MESSAGE_FLAG) !== 0,
  }
}

export function parseChannel(value: unknown): DiscordChannel | null {
  if (!isJson(value)) return null
  const id = str(value.id)
  const type = num(value.type)
  if (id === null || type === null) return null
  const metadata = isJson(value.thread_metadata) ? value.thread_metadata : null
  return {
    id,
    type,
    guild_id: str(value.guild_id),
    parent_id: str(value.parent_id),
    archived: metadata === null ? null : metadata.archived === true,
  }
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function parseMessage(value: unknown): DiscordMessage | null {
  if (!isJson(value)) return null
  const id = str(value.id)
  const channel_id = str(value.channel_id)
  const author = parseUser(value.author)
  const timestamp = str(value.timestamp)
  if (id === null || channel_id === null || author === null || timestamp === null) return null
  const flags = num(value.flags) ?? 0
  const ref = isJson(value.referenced_message) ? parseMessage(value.referenced_message) : null
  return {
    id,
    channel_id,
    author,
    timestamp,
    guild_id: str(value.guild_id),
    content: str(value.content) ?? "",
    mentions: list(value.mentions).flatMap((mention) => parseUser(mention)?.id ?? []),
    attachments: list(value.attachments).flatMap((attachment) => parseAttachment(attachment, flags) ?? []),
    referenced: ref === null ? null : { id: ref.id, author: ref.author.global_name ?? ref.author.username, content: ref.content },
    thread: parseChannel(value.thread),
  }
}

export function parseReaction(value: unknown): DiscordReaction | null {
  if (!isJson(value) || !isJson(value.emoji)) return null
  const user_id = str(value.user_id)
  const channel_id = str(value.channel_id)
  const message_id = str(value.message_id)
  if (user_id === null || channel_id === null || message_id === null) return null
  const member = isJson(value.member) ? parseUser(value.member.user) : null
  return {
    user_id,
    channel_id,
    message_id,
    guild_id: str(value.guild_id),
    emoji: { id: str(value.emoji.id), name: str(value.emoji.name) },
    is_bot: member?.bot === true,
    display: member?.global_name ?? member?.username ?? user_id,
  }
}

export function parseChannels(value: unknown): DiscordChannel[] {
  return list(value).flatMap((channel) => parseChannel(channel) ?? [])
}

export const DISCORD_EPOCH = 1_420_070_400_000n

/** The `after=` cursor (exclusive) that returns every message created at or after `ms`. */
export function snowflakeAfter(ms: number): string {
  const offset = BigInt(Math.max(0, Math.floor(ms))) - DISCORD_EPOCH
  return offset > 0n ? String((offset << 22n) - 1n) : "0"
}

export function compareSnowflakes(a: string, b: string): number {
  const x = BigInt(a)
  const y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}
