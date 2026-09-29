// In-memory model of the Bot API state the adapter touches, for tests and fake-server QA: chats,
// forum topics, messages (stored as the plain text Telegram shows after parsing HTML), the bot's
// reactions, uploads, drafts, files, and the update queue getUpdates serves. Synthetic ids only.
import type { ConformanceFixtures } from "../../adapter/conformance/types"
import type { SurfaceKey, UploadFile } from "../../adapter/contract"
import { reactionName } from "./reactions"
import { telegramDraftId } from "./render"

export type FakeChat = { id: number; type: "private" | "supergroup"; is_forum: boolean; title?: string }
export type FakeTgMessage = { chat_id: string; message_id: number; thread_id: number | null; text: string; from_bot: boolean; reactions: string[]; file: string | null }
export type FakeUser = { id: number; is_bot: boolean; first_name: string; username?: string }

export const FAKE_BOT = { id: 7000000001, is_bot: true, first_name: "QA Bot", username: "omo_qa_bot" }
export const FAKE_TOKEN = `${FAKE_BOT.id}:TEST-ONLY-TOKEN`
export const FAKE_HUMAN: FakeUser = { id: 1000000001, is_bot: false, first_name: "Alice", username: "alice_qa" }
export const FAKE_FORUM: FakeChat = { id: -1000000000001, type: "supergroup", is_forum: true, title: "QA forum" }
export const FAKE_DM: FakeChat = { id: FAKE_HUMAN.id, type: "private", is_forum: false }

const ALLOWED_REACTIONS = new Set(["\u{1F440}", "\u{270D}", "\u{1F44D}", "\u{1F44E}", "\u{1F634}", "\u{1F914}", "\u{1F525}", "\u{1F389}", "\u{1F64F}", "\u{1F44C}"])

export class FakeApiError extends Error {
  constructor(
    readonly error_code: number,
    readonly description: string,
    readonly parameters?: Record<string, unknown>,
  ) {
    super(description)
  }
}

function toPlain(html: string): string {
  const tags = html.match(/<[^>]*>/g) ?? []
  for (const tag of tags) {
    if (!/^<(b|\/b|\/a|a href="[^"<>]*")>$/.test(tag)) throw new FakeApiError(400, `Bad Request: can't parse entities: unsupported tag ${tag}`)
  }
  if (/&(?!(amp|lt|gt|quot);)/.test(html)) throw new FakeApiError(400, "Bad Request: can't parse entities: unescaped &")
  return html.replace(/<[^>]*>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&")
}

export class FakeTelegram {
  readonly chats = new Map<string, FakeChat>([
    [String(FAKE_FORUM.id), FAKE_FORUM],
    [String(FAKE_DM.id), FAKE_DM],
  ])
  readonly messages: FakeTgMessage[] = []
  readonly drafts: { chat_id: string; draft_id: number; text: string }[] = []
  readonly calls: { method: string; at: number }[] = []
  private readonly topics = new Map<string, { name: string; closed: boolean }>()
  private readonly files = new Map<string, { path: string; bytes: Uint8Array }>()
  private readonly updates: { update_id: number; [key: string]: unknown }[] = []
  private readonly messageSeq = new Map<string, number>()
  private readonly wakers = new Set<() => void>()
  private updateSeq = 0
  private topicSeq = 100
  private fileSeq = 0

  private chat(chat_id: unknown): FakeChat {
    const chat = this.chats.get(String(chat_id))
    if (chat === undefined) throw new FakeApiError(400, "Bad Request: chat not found")
    return chat
  }

  private nextMessageId(chat_id: string): number {
    const next = (this.messageSeq.get(chat_id) ?? 0) + 1
    this.messageSeq.set(chat_id, next)
    return next
  }

  private push(update: Record<string, unknown>): void {
    this.updateSeq += 1
    this.updates.push({ update_id: this.updateSeq, ...update })
    for (const wake of this.wakers) wake()
  }

  onUpdate(wake: () => void): () => void {
    this.wakers.add(wake)
    return () => this.wakers.delete(wake)
  }

  pending(offset: number): unknown[] {
    const keep = this.updates.filter((update) => update.update_id >= offset)
    this.updates.splice(0, this.updates.length, ...keep)
    return keep
  }

  message(chat_id: string, message_id: number): FakeTgMessage | undefined {
    return this.messages.find((entry) => entry.chat_id === chat_id && entry.message_id === message_id)
  }

  private threadOf(body: Record<string, unknown>): number | null {
    const thread = body.message_thread_id === undefined ? null : Number(body.message_thread_id)
    if (thread !== null && this.topics.get(`${body.chat_id}/${thread}`)?.closed === true) throw new FakeApiError(400, "Bad Request: TOPIC_CLOSED")
    return thread
  }

  private store(chat_id: string, thread_id: number | null, text: string, from_bot: boolean, file: string | null): FakeTgMessage {
    const message: FakeTgMessage = { chat_id, message_id: this.nextMessageId(chat_id), thread_id, text, from_bot, reactions: [], file }
    this.messages.push(message)
    return message
  }

  humanPost(input: { key: SurfaceKey; text: string; from?: FakeUser; voice?: Uint8Array }): FakeTgMessage {
    const chat = this.chat(input.key.chat_id)
    const thread_id = input.key.thread_id === null ? null : Number(input.key.thread_id)
    const stored = this.store(String(chat.id), thread_id, input.text, false, null)
    const payload: Record<string, unknown> = {
      message_id: stored.message_id,
      chat,
      from: input.from ?? FAKE_HUMAN,
      date: Math.floor(Date.now() / 1000),
      ...(input.text === "" ? {} : { text: input.text }),
      ...(thread_id === null ? {} : { message_thread_id: thread_id, is_topic_message: true }),
    }
    if (input.voice !== undefined) {
      this.fileSeq += 1
      const file_id = `file-${this.fileSeq}`
      this.files.set(file_id, { path: `voice/${file_id}.oga`, bytes: input.voice })
      payload.voice = { file_id, file_unique_id: `u${file_id}`, duration: 1, mime_type: "audio/ogg", file_size: input.voice.byteLength }
    }
    this.push({ message: payload })
    return stored
  }

  humanReact(chat_id: string, message_id: number, emoji: string, from: FakeUser = FAKE_HUMAN): void {
    const chat = this.chat(chat_id)
    this.push({ message_reaction: { chat, message_id, user: from, date: Math.floor(Date.now() / 1000), old_reaction: [], new_reaction: [{ type: "emoji", emoji }] } })
  }

  rawUpdate(update: Record<string, unknown>): void {
    this.push(update)
  }

  fileByPath(path: string): Uint8Array | undefined {
    return [...this.files.values()].find((file) => file.path === path)?.bytes
  }

  handle(method: string, body: Record<string, unknown>, file: { name: string } | null): unknown {
    this.calls.push({ method, at: Date.now() })
    switch (method) {
      case "getMe":
        return FAKE_BOT
      case "sendMessage": {
        const chat = this.chat(body.chat_id)
        const text = toPlain(String(body.text ?? ""))
        if (text.length > 4096) throw new FakeApiError(400, "Bad Request: message is too long")
        return { message_id: this.store(String(chat.id), this.threadOf(body), text, true, null).message_id, chat, date: 0 }
      }
      case "editMessageText": {
        const message = this.message(String(body.chat_id), Number(body.message_id))
        if (message === undefined || !message.from_bot) throw new FakeApiError(400, "Bad Request: message to edit not found")
        const text = toPlain(String(body.text ?? ""))
        if (text === message.text) throw new FakeApiError(400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same")
        message.text = text
        return { message_id: message.message_id }
      }
      case "setMessageReaction": {
        const message = this.message(String(body.chat_id), Number(body.message_id))
        if (message === undefined) throw new FakeApiError(400, "Bad Request: message not found")
        const wanted = Array.isArray(body.reaction) ? body.reaction.map((entry: { emoji?: unknown }) => String(entry.emoji)) : []
        if (wanted.some((emoji) => !ALLOWED_REACTIONS.has(emoji))) throw new FakeApiError(400, "Bad Request: REACTION_INVALID")
        message.reactions = wanted
        return true
      }
      case "sendChatAction":
        this.chat(body.chat_id)
        return true
      case "sendMessageDraft":
        this.drafts.push({ chat_id: String(this.chat(body.chat_id).id), draft_id: Number(body.draft_id), text: toPlain(String(body.text ?? "")) })
        return true
      case "sendDocument":
      case "sendPhoto": {
        const chat = this.chat(body.chat_id)
        if (file === null) throw new FakeApiError(400, "Bad Request: there is no file in the request")
        const caption = body.caption === undefined ? "" : toPlain(String(body.caption))
        return { message_id: this.store(String(chat.id), this.threadOf(body), caption, true, file.name).message_id }
      }
      case "createForumTopic": {
        const chat = this.chat(body.chat_id)
        if (!chat.is_forum) throw new FakeApiError(400, "Bad Request: the chat is not a forum")
        this.topicSeq += 1
        this.topics.set(`${chat.id}/${this.topicSeq}`, { name: String(body.name), closed: false })
        return { message_thread_id: this.topicSeq, name: String(body.name), icon_color: 0 }
      }
      case "closeForumTopic":
      case "reopenForumTopic": {
        const topic = this.topics.get(`${body.chat_id}/${body.message_thread_id}`)
        if (topic === undefined) throw new FakeApiError(400, "Bad Request: TOPIC_ID_INVALID")
        const closed = method === "closeForumTopic"
        if (topic.closed === closed) throw new FakeApiError(400, "Bad Request: TOPIC_NOT_MODIFIED")
        topic.closed = closed
        return true
      }
      case "getFile": {
        const found = this.files.get(String(body.file_id))
        if (found === undefined) throw new FakeApiError(400, "Bad Request: invalid file_id")
        return { file_id: body.file_id, file_path: found.path }
      }
      default:
        throw new FakeApiError(404, `Not Found: method ${method}`)
    }
  }

  isTopicClosed(chat_id: string, thread_id: string): boolean {
    return this.topics.get(`${chat_id}/${thread_id}`)?.closed === true
  }

  fixtures(files: readonly UploadFile[]): ConformanceFixtures {
    const at = (key: SurfaceKey) => (entry: FakeTgMessage) =>
      entry.chat_id === key.chat_id && entry.thread_id === (key.thread_id === null ? null : Number(key.thread_id))
    return {
      chat: { platform: "telegram", account_id: String(FAKE_BOT.id), chat_id: String(FAKE_FORUM.id), thread_id: null },
      humanPost: async ({ key, text }) => {
        this.humanPost({ key, text })
      },
      readMessage: async (key, message_id) => {
        const found = this.messages.find((entry) => at(key)(entry) && String(entry.message_id) === message_id)
        return found === undefined ? null : { text: found.text, reactions: found.reactions.map(reactionName) }
      },
      readUploads: async (key) => this.messages.filter((entry) => at(key)(entry) && entry.file !== null).map((entry) => entry.file ?? ""),
      readDrafts: async (key, draft_id) =>
        this.drafts.filter((draft) => draft.chat_id === key.chat_id && draft.draft_id === telegramDraftId(draft_id)).map((draft) => draft.text),
      files,
    }
  }
}
