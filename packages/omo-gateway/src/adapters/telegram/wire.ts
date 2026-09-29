// Parsers for the Bot API shapes the adapter reads. Updates arrive as untrusted JSON: a parser
// returns null for anything malformed, and the adapter skips it instead of crashing the poller.

export type TgUser = { id: number; is_bot: boolean; first_name: string; last_name: string | null; username: string | null }
export type TgChat = { id: number; type: string; username: string | null }
export type TgEntity = { type: string; offset: number; length: number; user_id: number | null }
export type TgFile = { file_id: string; file_name: string | null; mime_type: string | null; file_size: number }

export type TgMessage = {
  message_id: number
  chat: TgChat
  from: TgUser | null
  date: number
  edit_date: number | null
  text: string
  entities: readonly TgEntity[]
  thread_id: number | null
  reply_to: { message_id: number; from: TgUser | null; text: string } | null
  photo: TgFile | null
  document: TgFile | null
  voice: TgFile | null
  audio: TgFile | null
  video_note: TgFile | null
}

export type TgReaction = { chat: TgChat; message_id: number; user: TgUser | null; date: number; added: readonly string[] }

export type TgUpdate =
  | { update_id: number; kind: "message" | "edited_message"; message: TgMessage }
  | { update_id: number; kind: "message_reaction"; reaction: TgReaction }
  | { update_id: number; kind: "ignored" }

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function obj(value: unknown): Obj | null {
  return isObj(value) ? value : null
}

const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null)
const str = (value: unknown): string | null => (typeof value === "string" ? value : null)

function user(value: unknown): TgUser | null {
  const o = obj(value)
  const id = int(o?.id)
  if (o === null || id === null) return null
  return { id, is_bot: o.is_bot === true, first_name: str(o.first_name) ?? "", last_name: str(o.last_name), username: str(o.username) }
}

function chat(value: unknown): TgChat | null {
  const o = obj(value)
  const id = int(o?.id)
  const type = str(o?.type)
  if (o === null || id === null || type === null) return null
  return { id, type, username: str(o.username) }
}

function file(value: unknown): TgFile | null {
  const o = obj(value)
  const file_id = str(o?.file_id)
  if (o === null || file_id === null || file_id === "") return null
  return { file_id, file_name: str(o.file_name), mime_type: str(o.mime_type), file_size: int(o.file_size) ?? 0 }
}

function entities(value: unknown): TgEntity[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const o = obj(raw)
    const type = str(o?.type)
    const offset = int(o?.offset)
    const length = int(o?.length)
    if (o === null || type === null || offset === null || length === null) return []
    return [{ type, offset, length, user_id: user(o.user)?.id ?? null }]
  })
}

function largestPhoto(value: unknown): TgFile | null {
  if (!Array.isArray(value)) return null
  const sizes = value.map(file).filter((entry): entry is TgFile => entry !== null)
  return sizes.reduce<TgFile | null>((best, entry) => (best === null || entry.file_size >= best.file_size ? entry : best), null)
}

export function parseMessage(value: unknown): TgMessage | null {
  const o = obj(value)
  const message_id = int(o?.message_id)
  const parsedChat = chat(o?.chat)
  const date = int(o?.date)
  if (o === null || message_id === null || parsedChat === null || date === null) return null
  const reply = obj(o.reply_to_message)
  const replyId = int(reply?.message_id)
  const hasCaption = str(o.text) === null
  return {
    message_id,
    chat: parsedChat,
    from: user(o.from),
    date,
    edit_date: int(o.edit_date),
    text: str(o.text) ?? str(o.caption) ?? "",
    entities: entities(hasCaption ? o.caption_entities : o.entities),
    thread_id: o.is_topic_message === true ? int(o.message_thread_id) : null,
    reply_to: reply === null || replyId === null ? null : { message_id: replyId, from: user(reply.from), text: str(reply.text) ?? str(reply.caption) ?? "" },
    photo: largestPhoto(o.photo),
    document: file(o.document),
    voice: file(o.voice),
    audio: file(o.audio),
    video_note: file(o.video_note),
  }
}

function emojis(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const o = obj(raw)
    const emoji = o?.type === "emoji" ? str(o.emoji) : null
    return emoji === null ? [] : [emoji]
  })
}

function parseReaction(value: unknown): TgReaction | null {
  const o = obj(value)
  const parsedChat = chat(o?.chat)
  const message_id = int(o?.message_id)
  const date = int(o?.date)
  if (o === null || parsedChat === null || message_id === null || date === null) return null
  const before = new Set(emojis(o.old_reaction))
  return { chat: parsedChat, message_id, user: user(o.user), date, added: emojis(o.new_reaction).filter((emoji) => !before.has(emoji)) }
}

/** One raw getUpdates entry, or null when it has no usable update_id (it cannot even be acknowledged). */
export function parseUpdate(value: unknown): TgUpdate | null {
  const o = obj(value)
  const update_id = int(o?.update_id)
  if (o === null || update_id === null) return null
  for (const kind of ["message", "edited_message"] as const) {
    if (o[kind] === undefined) continue
    const message = parseMessage(o[kind])
    return message === null ? { update_id, kind: "ignored" } : { update_id, kind, message }
  }
  if (o.message_reaction !== undefined) {
    const reaction = parseReaction(o.message_reaction)
    return reaction === null ? { update_id, kind: "ignored" } : { update_id, kind: "message_reaction", reaction }
  }
  return { update_id, kind: "ignored" }
}
