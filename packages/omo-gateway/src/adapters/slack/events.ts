// Slack message / edit / reaction -> InboundEvent, with the kind classified. The gateway's
// own posts are dropped here; other bots arrive with `is_bot` so core's bot_ignore gate decides.
// One Slack message has the same event_id from RTM, Socket Mode and history: `<channel>:<ts>`.
import type { InboundAttachment, InboundEvent, InboundKind, SurfaceKey } from "../../adapter/contract"
import { isAudioAttachment, voiceFields, type TranscribeResult } from "../../stt/transcribe"
import { reactionName } from "./render"
import { tsToIso, type SlackFile, type SlackMessage, type SlackReaction } from "./wire"

export const GATEWAY_MARKER_EVENT = "omo_gateway"

/** Subtypes that are a person (or bot) saying something; every other subtype is housekeeping. */
const SPEECH_SUBTYPES = new Set(["thread_broadcast", "file_share", "bot_message", "me_message"])

export type Identity = { team_id: string; user_id: string; bot_id: string | null; url: string }
export type Author = { display: string; is_bot: boolean }
export type Speaker = { user: string | null; bot_id: string | null; username: string | null }

export type EventContext = {
  account_id: string
  self: Identity
  author(speaker: Speaker): Promise<Author>
  transcribe(file: SlackFile): Promise<TranscribeResult>
  threadOf(channel: string, ts: string): string | null
}

export function permalink(self: Identity, channel: string, ts: string, thread_ts: string | null): string {
  const base = `${self.url.replace(/\/+$/, "")}/archives/${channel}/p${ts.replace(".", "")}`
  return thread_ts === null || thread_ts === ts ? base : `${base}?thread_ts=${thread_ts}&cid=${channel}`
}

export const isDirectChannel = (channel: string): boolean => channel.startsWith("D")

const threadId = (message: SlackMessage): string | null => (message.thread_ts !== null && message.thread_ts !== message.ts ? message.thread_ts : null)

function isOwn(context: EventContext, message: SlackMessage): boolean {
  return message.user === context.self.user_id || (message.bot_id !== null && message.bot_id === context.self.bot_id)
}

/** `<!here>`, `<!channel>`, `<!everyone>` (optionally with a `|label`): Slack's whole-chat mentions */
const BROADCAST_MENTION = /<!(?:here|channel|everyone)(?:\|[^>]*)?>/

function classify(context: EventContext, message: SlackMessage): { kind: InboundKind; broadcast: boolean } {
  if (isDirectChannel(message.channel)) return { kind: "dm", broadcast: false }
  if (message.text.includes(`<@${context.self.user_id}>`)) return { kind: "mention", broadcast: false }
  if (BROADCAST_MENTION.test(message.text)) return { kind: "mention", broadcast: true }
  return { kind: threadId(message) === null ? "channel" : "thread_reply", broadcast: false }
}

function voiceFile(message: SlackMessage): SlackFile | undefined {
  return message.files.find((file) => file.subtype === "slack_audio" || isAudioAttachment({ name: file.name, mime: file.mime }))
}

const attachments = (message: SlackMessage): InboundAttachment[] => message.files.map((file) => ({ name: file.name, url: file.url, mime: file.mime, bytes: file.bytes }))

function key(context: EventContext, channel: string, thread_id: string | null): SurfaceKey {
  return { platform: "slack", account_id: context.account_id, chat_id: channel, thread_id }
}

/** A new message; null for the gateway's own posts, hidden events and housekeeping subtypes. */
export async function messageEvent(context: EventContext, message: SlackMessage): Promise<InboundEvent | null> {
  if (message.hidden || isOwn(context, message)) return null
  if (message.subtype !== null && !SPEECH_SUBTYPES.has(message.subtype)) return null
  if (message.user === null && message.bot_id === null) return null
  const author = await context.author(message)
  const voice = voiceFile(message)
  const fields = voice === undefined ? { text: message.text, transcript: null } : voiceFields(message.text, await context.transcribe(voice))
  const thread = threadId(message)
  const { kind, broadcast } = classify(context, message)
  return {
    event_id: `${message.channel}:${message.ts}`,
    key: key(context, message.channel, thread),
    author: { platform_user_id: message.user ?? message.bot_id ?? "", display: author.display, is_bot: author.is_bot },
    kind,
    ...(broadcast ? { broadcast: true } : {}),
    reaction: null,
    edited: null,
    gateway_marker: message.marker_event_type === GATEWAY_MARKER_EVENT,
    text: fields.text,
    transcript: fields.transcript,
    attachments: attachments(message),
    reply_to: null,
    at: tsToIso(message.ts),
    permalink: permalink(context.self, message.channel, message.ts, message.thread_ts),
  }
}

/** A human edited a message (`message_changed` carrying `edited`); link unfurls and our own edits are not edits. */
export async function editEvent(context: EventContext, message: SlackMessage): Promise<InboundEvent | null> {
  if (message.edited_ts === null) return null
  const base = await messageEvent(context, { ...message, subtype: null })
  if (base === null) return null
  return {
    ...base,
    event_id: `${message.channel}:${message.ts}:edited:${message.edited_ts}`,
    kind: "edit",
    edited: { object_id: message.ts, field: "text" },
    at: tsToIso(message.edited_ts),
  }
}

export async function reactionEvent(context: EventContext, reaction: SlackReaction): Promise<InboundEvent | null> {
  if (reaction.user === context.self.user_id) return null
  const author = await context.author({ user: reaction.user, bot_id: null, username: null })
  const thread = context.threadOf(reaction.channel, reaction.ts)
  return {
    event_id: `${reaction.channel}:${reaction.ts}:reaction:${reaction.user}:${reaction.name}:${reaction.event_ts}`,
    key: key(context, reaction.channel, thread),
    author: { platform_user_id: reaction.user, display: author.display, is_bot: author.is_bot },
    kind: "reaction",
    reaction: { name: reactionName(reaction.name), on_message_id: reaction.ts },
    edited: null,
    gateway_marker: false,
    text: "",
    transcript: null,
    attachments: [],
    reply_to: null,
    at: tsToIso(reaction.event_ts),
    permalink: permalink(context.self, reaction.channel, reaction.ts, thread),
  }
}
