import { checkCapability } from "../../adapter/capability"
import { AdapterRefusal, type Capabilities, type RenderedOp, type RichBody, type SendResult, type SurfaceKey, type UploadFile } from "../../adapter/contract"
import { plainText } from "../../adapter/rich"
import type { ChannelDirectory } from "./channels"
import { permalink } from "./events"
import { targetChannel } from "./inbound"
import { mentionedUsers, reactionEmoji, renderContent } from "./render"
import type { ChannelBucket, DiscordRest } from "./rest"
import { isJson, parseChannel, type Json } from "./wire"

const DISCORD_MAX_CONTENT = 2000
const FILES_PER_MESSAGE = 10
const THREAD_NAME_MAX = 100
const WEEK_MINUTES = 10080
const VIEW_AND_SEND = String((1 << 10) | (1 << 11) | (1 << 16))

export type OutboundOptions = {
  account_id: string
  guild_id: string | null
  rest: DiscordRest
  bucket: ChannelBucket
  channels: ChannelDirectory
  capabilities: Capabilities
}

function messageId(body: unknown, what: string): string {
  if (isJson(body) && typeof body.id === "string") return body.id
  throw new Error(`discord ${what} returned no id`)
}

function threadName(root: RichBody): string {
  const name = plainText(root).replace(/\s+/g, " ").trim().slice(0, THREAD_NAME_MAX)
  return name === "" ? "thread" : name
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

export class DiscordOutbound {
  constructor(private readonly options: OutboundOptions) {}

  async send(op: RenderedOp): Promise<SendResult> {
    const refusal = checkCapability("discord", this.options.capabilities, op)
    if (refusal !== null) throw refusal
    const { rest } = this.options
    switch (op.op) {
      case "post":
        return this.result(targetChannel(op.key), await this.post(op.key, op.body, "post"))
      case "edit": {
        const channel = targetChannel(op.key)
        await this.options.bucket.take(channel)
        const body = await rest.request("PATCH", `/channels/${channel}/messages/${op.message_id}`, { json: this.content(op.body, "edit") })
        return this.result(channel, messageId(body, "edit"))
      }
      case "react":
      case "unreact": {
        const path = `/channels/${targetChannel(op.key)}/messages/${op.message_id}/reactions/${encodeURIComponent(reactionEmoji(op.name))}/@me`
        await rest.request(op.op === "react" ? "PUT" : "DELETE", path)
        return { message_id: "", permalink: "", created: null }
      }
      case "typing":
        await rest.request("POST", `/channels/${targetChannel(op.key)}/typing`)
        return { message_id: "", permalink: "", created: null }
      case "upload":
        return this.result(targetChannel(op.key), await this.upload(op.key, op.files, op.comment))
      case "open_thread":
        return this.openThread(op.key, op.root)
      case "archive_thread":
      case "reopen_thread": {
        if (op.key.thread_id === null) throw new AdapterRefusal(op.op, "thread_archive", `${op.op} needs a thread key; chat ${op.key.chat_id} is not a thread`)
        this.options.channels.remember(parseChannel(await rest.request("PATCH", `/channels/${op.key.thread_id}`, { json: { archived: op.op === "archive_thread" } })))
        return { message_id: "", permalink: "", created: null }
      }
      case "create_chat": {
        const members = op.members ?? []
        const created = parseChannel(
          await rest.request("POST", `/guilds/${this.options.guild_id}/channels`, {
            json: { name: op.name.slice(0, THREAD_NAME_MAX), type: 0, permission_overwrites: members.map((id) => ({ id, type: 1, allow: VIEW_AND_SEND })) },
          }),
        )
        if (created === null) throw new Error("discord create_chat returned no channel")
        this.options.channels.remember(created)
        return { message_id: "", permalink: "", created: { platform: "discord", account_id: op.key.account_id, chat_id: created.id, thread_id: null } }
      }
      case "stream_draft":
        throw new AdapterRefusal(op.op, "draft_stream", "Discord shows no draft preview; stream_draft is refused")
    }
  }

  private content(body: RichBody, op: RenderedOp["op"]): Json {
    const content = renderContent(body)
    if (content.length > DISCORD_MAX_CONTENT) {
      throw new AdapterRefusal(op, "max_text", `${op} renders to ${content.length} characters of Discord markdown; Discord carries at most ${DISCORD_MAX_CONTENT}`)
    }
    return { content, allowed_mentions: { parse: [], users: mentionedUsers(body) } }
  }

  private async post(key: SurfaceKey, body: RichBody, op: RenderedOp["op"]): Promise<string> {
    const channel = targetChannel(key)
    const json = this.content(body, op)
    await this.options.bucket.take(channel)
    return messageId(await this.options.rest.request("POST", `/channels/${channel}/messages`, { json }), op)
  }

  private async upload(key: SurfaceKey, files: readonly UploadFile[], comment: RichBody | null): Promise<string> {
    const channel = targetChannel(key)
    const caption = comment === null ? null : this.content(comment, "upload")
    let first: string | null = null
    for (const [index, group] of chunks(files, FILES_PER_MESSAGE).entries()) {
      const named = group.map((file, id) => ({ id, file, filename: file.title.replace(/[\\/]/g, "_") }))
      const payload = { ...(index === 0 && caption !== null ? caption : { allowed_mentions: { parse: [] } }), attachments: named.map(({ id, filename }) => ({ id, filename })) }
      const form = () => {
        const data = new FormData()
        data.append("payload_json", JSON.stringify(payload))
        for (const entry of named) data.append(`files[${entry.id}]`, Bun.file(entry.file.path), entry.filename)
        return data
      }
      await this.options.bucket.take(channel)
      const id = messageId(await this.options.rest.request("POST", `/channels/${channel}/messages`, { form }), "upload")
      first ??= id
    }
    if (first === null) throw new AdapterRefusal("upload", "uploads", "upload carries no files")
    return first
  }

  private async openThread(key: SurfaceKey, root: RichBody): Promise<SendResult> {
    if (key.thread_id !== null) throw new AdapterRefusal("open_thread", "threads", "Discord cannot open a thread inside a thread")
    const rootId = await this.post(key, root, "open_thread")
    const thread = parseChannel(
      await this.options.rest.request("POST", `/channels/${key.chat_id}/messages/${rootId}/threads`, { json: { name: threadName(root), auto_archive_duration: WEEK_MINUTES } }),
    )
    if (thread === null) throw new Error("discord open_thread returned no thread channel")
    this.options.channels.remember({ ...thread, parent_id: thread.parent_id ?? key.chat_id })
    return { ...(await this.result(key.chat_id, rootId)), created: { ...key, thread_id: thread.id } }
  }

  private async result(channel: string, message_id: string): Promise<SendResult> {
    const guild = (await this.options.channels.get(channel))?.guild_id ?? null
    return { message_id, permalink: permalink(guild, channel, message_id), created: null }
  }
}
