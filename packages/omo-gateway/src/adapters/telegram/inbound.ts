import type { InboundAttachment, InboundAuthor, InboundEvent, InboundKind } from "../../adapter/contract"
import { reactionName } from "./reactions"
import type { TgChat, TgFile, TgMessage, TgReaction, TgUpdate, TgUser } from "./wire"

export type BotIdentity = { id: number; username: string | null }

export type InboundDraft = { event: InboundEvent; voice: TgFile | null }

// File URLs carry the bot token, so events reference files by id and the adapter resolves them.
export const fileUrl = (file: TgFile) => `tg-file:${file.file_id}`

function author(from: TgUser | null, chat: TgChat): InboundAuthor {
  if (from === null) return { platform_user_id: `chat:${chat.id}`, display: chat.username ?? "", is_bot: false }
  const name = [from.first_name, from.last_name].filter((part) => part !== null && part !== "").join(" ")
  return { platform_user_id: String(from.id), display: name || (from.username ?? String(from.id)), is_bot: from.is_bot }
}

export function permalink(chat: TgChat, message_id: number, thread_id: number | null): string {
  const tail = thread_id === null ? `${message_id}` : `${thread_id}/${message_id}`
  if (chat.username !== null) return `https://t.me/${chat.username}/${tail}`
  const id = String(chat.id)
  return id.startsWith("-100") ? `https://t.me/c/${id.slice(4)}/${tail}` : ""
}

function mentionsBot(message: TgMessage, bot: BotIdentity): boolean {
  if (message.reply_to?.from?.id === bot.id) return true
  const handle = bot.username === null ? null : `@${bot.username.toLowerCase()}`
  return message.entities.some((entity) => {
    if (entity.type === "text_mention") return entity.user_id === bot.id
    if (entity.type !== "mention" || handle === null) return false
    return message.text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === handle
  })
}

function messageKind(message: TgMessage, bot: BotIdentity): InboundKind {
  if (message.chat.type === "private") return "dm"
  if (mentionsBot(message, bot)) return "mention"
  return message.thread_id === null ? "channel" : "thread_reply"
}

function attachments(message: TgMessage): InboundAttachment[] {
  const entries: [TgFile | null, string, string][] = [
    [message.photo, "photo.jpg", "image/jpeg"],
    [message.document, "document", "application/octet-stream"],
    [message.voice, "voice.oga", "audio/ogg"],
    [message.audio, "audio", "audio/mpeg"],
    [message.video_note, "video_note.mp4", "video/mp4"],
  ]
  return entries.flatMap(([file, name, mime]) =>
    file === null ? [] : [{ name: file.file_name ?? name, url: fileUrl(file), mime: file.mime_type ?? mime, bytes: file.file_size }],
  )
}

function messageDraft(message: TgMessage, edited: boolean, account_id: string, bot: BotIdentity): InboundDraft | null {
  const files = attachments(message)
  if (message.text === "" && files.length === 0) return null
  const chat_id = String(message.chat.id)
  const changedAt = edited ? (message.edit_date ?? message.date) : message.date
  const event: InboundEvent = {
    event_id: edited ? `${chat_id}:${message.message_id}:edit:${changedAt}` : `${chat_id}:${message.message_id}`,
    key: { platform: "telegram", account_id, chat_id, thread_id: message.thread_id === null ? null : String(message.thread_id) },
    author: author(message.from, message.chat),
    kind: edited ? "edit" : messageKind(message, bot),
    reaction: null,
    edited: edited ? { object_id: String(message.message_id), field: "text" } : null,
    gateway_marker: false,
    text: message.text,
    transcript: null,
    attachments: files,
    reply_to:
      message.reply_to === null
        ? null
        : { message_id: String(message.reply_to.message_id), author: message.reply_to.from === null ? "" : author(message.reply_to.from, message.chat).display, text: message.reply_to.text },
    at: new Date(changedAt * 1000).toISOString(),
    permalink: permalink(message.chat, message.message_id, message.thread_id),
  }
  return { event, voice: message.voice ?? message.audio ?? message.video_note }
}

function reactionDrafts(reaction: TgReaction, account_id: string): InboundDraft[] {
  const chat_id = String(reaction.chat.id)
  const who = author(reaction.user, reaction.chat)
  return reaction.added.map((emoji) => ({
    voice: null,
    event: {
      event_id: `${chat_id}:${reaction.message_id}:reaction:${who.platform_user_id}:${emoji}:${reaction.date}`,
      key: { platform: "telegram", account_id, chat_id, thread_id: null },
      author: who,
      kind: "reaction",
      reaction: { name: reactionName(emoji), on_message_id: String(reaction.message_id) },
      edited: null,
      gateway_marker: false,
      text: "",
      transcript: null,
      attachments: [],
      reply_to: null,
      at: new Date(reaction.date * 1000).toISOString(),
      permalink: permalink(reaction.chat, reaction.message_id, null),
    },
  }))
}

export function toInboundDrafts(update: TgUpdate, account_id: string, bot: BotIdentity): InboundDraft[] {
  switch (update.kind) {
    case "message":
    case "edited_message": {
      const draft = messageDraft(update.message, update.kind === "edited_message", account_id, bot)
      return draft === null ? [] : [draft]
    }
    case "message_reaction":
      return reactionDrafts(update.reaction, account_id)
    case "ignored":
      return []
  }
}
