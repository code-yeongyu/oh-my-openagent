import type { InboundEvent, InboundKind, SurfaceKey } from "../../adapter/contract"
import { isAudioAttachment, voiceFields, type TranscribeResult } from "../../stt/transcribe"
import { reactionName } from "./render"
import { isDmType, isThreadType, type DiscordAttachment, type DiscordChannel, type DiscordMessage, type DiscordReaction } from "./wire"

export type EventContext = {
  account_id: string
  channel(id: string): Promise<DiscordChannel | null>
  transcribe(attachment: DiscordAttachment): Promise<TranscribeResult>
}

type Place = { key: SurfaceKey; guild_id: string | null; dm: boolean; in_thread: boolean }

export function permalink(guild_id: string | null, channel_id: string, message_id: string): string {
  return `https://discord.com/channels/${guild_id ?? "@me"}/${channel_id}/${message_id}`
}

export function messageEventId(channel_id: string, message_id: string): string {
  return `${channel_id}:${message_id}`
}

async function place(context: EventContext, channel_id: string, guild_hint: string | null): Promise<Place> {
  const channel = await context.channel(channel_id)
  const guild_id = guild_hint ?? channel?.guild_id ?? null
  const in_thread = channel !== null && isThreadType(channel.type) && channel.parent_id !== null
  const chat_id = in_thread ? (channel.parent_id ?? channel_id) : channel_id
  return {
    key: { platform: "discord", account_id: context.account_id, chat_id, thread_id: in_thread ? channel_id : null },
    guild_id,
    dm: guild_id === null && (channel === null || isDmType(channel.type)),
    in_thread,
  }
}

function kindOf(where: Place, mentionsUs: boolean): InboundKind {
  if (where.dm) return "dm"
  if (mentionsUs) return "mention"
  return where.in_thread ? "thread_reply" : "channel"
}

function voiceAttachment(message: DiscordMessage): DiscordAttachment | undefined {
  return message.attachments.find((attachment) => attachment.voice || isAudioAttachment({ name: attachment.filename, mime: attachment.content_type }))
}

/** The InboundEvent for a message, from the gateway or from REST; null for the gateway's own posts. */
export async function messageEvent(context: EventContext, message: DiscordMessage): Promise<InboundEvent | null> {
  if (message.author.id === context.account_id) return null
  const where = await place(context, message.channel_id, message.guild_id)
  const voice = voiceAttachment(message)
  const fields = voice === undefined ? { text: message.content, transcript: null } : voiceFields(message.content, await context.transcribe(voice))
  return {
    event_id: messageEventId(message.channel_id, message.id),
    key: where.key,
    author: { platform_user_id: message.author.id, display: message.author.global_name ?? message.author.username, is_bot: message.author.bot },
    kind: kindOf(where, message.mentions.includes(context.account_id)),
    reaction: null,
    edited: null,
    gateway_marker: false,
    text: fields.text,
    transcript: fields.transcript,
    attachments: message.attachments.map((attachment) => ({ name: attachment.filename, url: attachment.url, mime: attachment.content_type, bytes: attachment.size })),
    reply_to: message.referenced === null ? null : { message_id: message.referenced.id, author: message.referenced.author, text: message.referenced.content },
    at: new Date(message.timestamp).toISOString(),
    permalink: permalink(where.guild_id, message.channel_id, message.id),
  }
}

/** The InboundEvent for MESSAGE_REACTION_ADD; null for the gateway's own reactions. */
export async function reactionEvent(context: EventContext, reaction: DiscordReaction, at: string): Promise<InboundEvent | null> {
  if (reaction.user_id === context.account_id) return null
  const where = await place(context, reaction.channel_id, reaction.guild_id)
  const name = reactionName(reaction.emoji)
  return {
    event_id: `${messageEventId(reaction.channel_id, reaction.message_id)}:reaction:${reaction.user_id}:${name}`,
    key: where.key,
    author: { platform_user_id: reaction.user_id, display: reaction.display, is_bot: reaction.is_bot },
    kind: "reaction",
    reaction: { name, on_message_id: reaction.message_id },
    edited: null,
    gateway_marker: false,
    text: "",
    transcript: null,
    attachments: [],
    reply_to: null,
    at,
    permalink: permalink(where.guild_id, reaction.channel_id, reaction.message_id),
  }
}
