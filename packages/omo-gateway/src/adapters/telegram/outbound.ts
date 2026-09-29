import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { AdapterRefusal, type RenderedOp, type RichBody, type SendResult, type SurfaceKey, type UploadFile } from "../../adapter/contract"
import { plainText } from "../../adapter/rich"
import { TelegramApiError, type TelegramApi } from "./api"
import { permalink } from "./inbound"
import type { TelegramRateLimiter } from "./rate"
import { reactionEmoji } from "./reactions"
import { renderTelegramHtml, telegramDraftId } from "./render"

type Sent = { message_id: number }
type Topic = { message_thread_id: number }

const CAPTION_LIMIT = 1024
const PHOTO = /\.(png|jpe?g|webp)$/i

function threadField(key: SurfaceKey): { message_thread_id?: number } {
  if (key.thread_id === null) return {}
  const id = Number(key.thread_id)
  if (!Number.isSafeInteger(id)) throw new Error(`telegram thread_id must be a topic number, got ${key.thread_id}`)
  return { message_thread_id: id }
}

function messageNumber(message_id: string): number {
  const id = Number(message_id)
  if (!Number.isSafeInteger(id)) throw new Error(`telegram message_id must be a number, got ${message_id}`)
  return id
}

function linkTo(key: SurfaceKey, message_id: number): string {
  const chatNumber = Number(key.chat_id)
  if (!Number.isSafeInteger(chatNumber)) return ""
  return permalink({ id: chatNumber, type: "", username: null }, message_id, key.thread_id === null ? null : Number(key.thread_id))
}

const isUnchanged = (error: unknown) => error instanceof TelegramApiError && /not modified/i.test(error.description)

export class TelegramSender {
  private readonly reactions = new Map<string, string>()

  constructor(
    private readonly api: TelegramApi,
    private readonly limiter: TelegramRateLimiter,
  ) {}

  private result(key: SurfaceKey, message_id: number | null, created: SurfaceKey | null = null): SendResult {
    return message_id === null ? { message_id: "", permalink: "", created } : { message_id: String(message_id), permalink: linkTo(key, message_id), created }
  }

  private post(key: SurfaceKey, body: RichBody): Promise<Sent> {
    return this.limiter.schedule(key.chat_id, () =>
      this.api.call<Sent>("sendMessage", {
        chat_id: key.chat_id,
        text: renderTelegramHtml(body),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...threadField(key),
      }),
    )
  }

  private async edit(key: SurfaceKey, message_id: string, body: RichBody): Promise<void> {
    const request = { chat_id: key.chat_id, message_id: messageNumber(message_id), text: renderTelegramHtml(body), parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    await this.limiter.schedule(key.chat_id, () => this.api.call("editMessageText", request)).catch((error: unknown) => {
      if (!isUnchanged(error)) throw error
    })
  }

  private async setReaction(key: SurfaceKey, message_id: string, emoji: string | null): Promise<void> {
    const reaction = emoji === null ? [] : [{ type: "emoji", emoji }]
    await this.api.call("setMessageReaction", { chat_id: key.chat_id, message_id: messageNumber(message_id), reaction })
  }

  private async react(op: Extract<RenderedOp, { op: "react" | "unreact" }>): Promise<void> {
    const slot = `${op.key.chat_id}:${op.message_id}`
    const emoji = reactionEmoji(op.name)
    if (op.op === "react") {
      if (emoji === null) {
        throw new AdapterRefusal("react", "reactions", `Telegram has no reaction for ${op.name}; numbered answers on Telegram arrive as reply text (a reply "1".."9" to the question)`)
      }
      await this.setReaction(op.key, op.message_id, emoji)
      this.reactions.set(slot, op.name)
      return
    }
    const current = this.reactions.get(slot)
    if (emoji === null || (current !== undefined && current !== op.name)) return
    await this.setReaction(op.key, op.message_id, null)
    this.reactions.delete(slot)
  }

  private async uploadOne(key: SurfaceKey, file: UploadFile, caption: RichBody | null): Promise<Sent> {
    const bytes = await readFile(file.path)
    const method = PHOTO.test(file.title) || PHOTO.test(file.path) ? "sendPhoto" : "sendDocument"
    const form = () => {
      const data = new FormData()
      data.append("chat_id", key.chat_id)
      const thread = threadField(key).message_thread_id
      if (thread !== undefined) data.append("message_thread_id", String(thread))
      data.append(method === "sendPhoto" ? "photo" : "document", new Blob([bytes]), file.title || basename(file.path))
      if (caption !== null) {
        data.append("caption", renderTelegramHtml(caption))
        data.append("parse_mode", "HTML")
      }
      return data
    }
    return this.limiter.schedule(key.chat_id, () => this.api.call<Sent>(method, form))
  }

  private async upload(key: SurfaceKey, files: readonly UploadFile[], comment: RichBody | null): Promise<number | null> {
    const captionFits = comment !== null && plainText(comment).length <= CAPTION_LIMIT
    let first: number | null = null
    if (comment !== null && !captionFits) first = (await this.post(key, comment)).message_id
    for (const [index, file] of files.entries()) {
      const sent = await this.uploadOne(key, file, index === 0 && captionFits ? comment : null)
      first ??= sent.message_id
    }
    return first
  }

  private async topicState(key: SurfaceKey, method: "closeForumTopic" | "reopenForumTopic"): Promise<void> {
    await this.api.call(method, { chat_id: key.chat_id, ...threadField(key) }).catch((error: unknown) => {
      if (!(error instanceof TelegramApiError && /TOPIC_NOT_MODIFIED/.test(error.description))) throw error
    })
  }

  async send(op: RenderedOp): Promise<SendResult> {
    switch (op.op) {
      case "post":
        return this.result(op.key, (await this.post(op.key, op.body)).message_id)
      case "edit":
        await this.edit(op.key, op.message_id, op.body)
        return this.result(op.key, messageNumber(op.message_id))
      case "react":
      case "unreact":
        await this.react(op)
        return this.result(op.key, null)
      case "typing":
        await this.api.call("sendChatAction", { chat_id: op.key.chat_id, action: "typing", ...threadField(op.key) })
        return this.result(op.key, null)
      case "upload":
        return this.result(op.key, await this.upload(op.key, op.files, op.comment))
      case "open_thread": {
        const chat: SurfaceKey = { ...op.key, thread_id: null }
        const name = plainText(op.root).trim().slice(0, 128) || "Thread"
        const topic = await this.api.call<Topic>("createForumTopic", { chat_id: chat.chat_id, name })
        const thread: SurfaceKey = { ...chat, thread_id: String(topic.message_thread_id) }
        return this.result(thread, (await this.post(thread, op.root)).message_id, thread)
      }
      case "archive_thread":
        await this.topicState(op.key, "closeForumTopic")
        return this.result(op.key, null)
      case "reopen_thread":
        await this.topicState(op.key, "reopenForumTopic")
        return this.result(op.key, null)
      case "create_chat":
        throw new AdapterRefusal("create_chat", "chat_create", "Telegram bots cannot create chats")
      case "stream_draft": {
        const body: RichBody = [{ t: "text", text: op.text }]
        if (op.final) return this.result(op.key, (await this.post(op.key, body)).message_id)
        await this.draft(op.key, telegramDraftId(op.draft_id), body)
        return this.result(op.key, null)
      }
    }
  }

  private async draft(key: SurfaceKey, draft_id: number, body: RichBody): Promise<void> {
    await this.api.call("sendMessageDraft", { chat_id: key.chat_id, draft_id, text: renderTelegramHtml(body), parse_mode: "HTML", ...threadField(key) })
  }
}
