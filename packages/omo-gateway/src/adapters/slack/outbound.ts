// RenderedOp -> Slack Web API. A send resolves only after Slack answered `ok: true` and returned the
// message ts; every message write (post, edit, upload completion) takes the channel's token first.
import { checkCapability } from "../../adapter/capability"
import { AdapterRefusal, type Capabilities, type RenderedOp, type RichBody, type SendResult, type SurfaceKey } from "../../adapter/contract"
import { SlackApiError, type SlackApi } from "./api"
import type { ChannelTokenBucket } from "./bucket"
import type { SlackClock } from "./clock"
import type { SlackDirectory } from "./directory"
import { GATEWAY_MARKER_EVENT, permalink } from "./events"
import type { SlackRealtime } from "./realtime"
import { messagePayload, slackReaction } from "./render"
import { SlackDraftStreams } from "./stream"
import { uploadFiles } from "./upload"
import { isJson, isTs, type Json } from "./wire"

export type TokenKind = "user" | "bot"

/** A typing frame could not go out: the realtime line was not ready within the budget. Posting is unaffected. */
export class SlackTypingUnavailable extends Error {
  constructor(reason: string) {
    super(`slack typing not shown: ${reason}`)
    this.name = "SlackTypingUnavailable"
  }
}

export type OutboundOptions = {
  kind: TokenKind
  account_id: string
  api: SlackApi
  bucket: ChannelTokenBucket
  clock: SlackClock
  directory: SlackDirectory
  realtime: SlackRealtime
  capabilities: Capabilities
  typingBudgetMs: number
  log: (line: string) => void
}

const NOTHING: SendResult = { message_id: "", permalink: "", created: null }
const IDEMPOTENT = new Set(["already_reacted", "no_reaction"])
const METADATA_REFUSED = /metadata/

function channelName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
  return cleaned === "" ? "gateway" : cleaned
}

export class SlackOutbound {
  private marker = true
  private readonly drafts: SlackDraftStreams

  constructor(private readonly options: OutboundOptions) {
    this.drafts = new SlackDraftStreams({
      api: options.api,
      bucket: options.bucket,
      directory: options.directory,
      account_id: options.account_id,
      post: (key, body) => this.post(key, body),
      edit: (key, message_id, body) => this.edit(key, message_id, body),
      result: (key, ts) => this.result(key, ts),
    })
  }

  async send(op: RenderedOp): Promise<SendResult> {
    const refusal = checkCapability("slack", this.options.capabilities, op)
    if (refusal !== null) throw refusal
    switch (op.op) {
      case "post":
        return this.post(op.key, op.body)
      case "edit":
        return this.edit(op.key, op.message_id, op.body)
      case "react":
      case "unreact":
        await this.react(op.op, op.key, op.message_id, op.name)
        return NOTHING
      case "typing":
        await this.typing(op.key)
        return NOTHING
      case "upload": {
        const { api, bucket, clock, log } = this.options
        return uploadFiles({ api, bucket, clock, log, result: (key, ts) => this.result(key, ts) }, op.key, op.files, op.comment)
      }
      case "open_thread": {
        if (op.key.thread_id !== null) throw new AdapterRefusal("open_thread", "threads", "Slack cannot open a thread inside a thread")
        const root = await this.post(op.key, op.root)
        this.options.directory.rememberOwnThread(op.key.chat_id, root.message_id)
        return { ...root, created: { ...op.key, thread_id: root.message_id } }
      }
      case "archive_thread":
      case "reopen_thread":
        throw new AdapterRefusal(op.op, "thread_archive", "Slack threads cannot be archived")
      case "create_chat":
        return this.createChat(op.key.account_id, op.name, op.kind, op.members ?? [])
      case "stream_draft":
        return this.drafts.send(op)
    }
  }

  private markerParam(): { metadata?: string } {
    if (!this.marker) return {}
    return { metadata: JSON.stringify({ event_type: GATEWAY_MARKER_EVENT, event_payload: { account_id: this.options.account_id } }) }
  }

  /**
   * Call a message write with the gateway marker. A token that refuses metadata loses the marker once
   * and the call is retried without it; a token that accepts the post but does not store the metadata
   * (a member session token, measured live) loses it too, so no later post claims a marker it lacks.
   */
  private async write(method: string, params: Record<string, string | undefined>): Promise<Json> {
    const marked = this.marker
    try {
      const reply = await this.options.api.call(method, { ...params, ...this.markerParam() })
      const stored = isJson(reply.message) && isJson(reply.message.metadata)
      if (marked && method === "chat.postMessage" && !stored) {
        this.marker = false
        this.options.log("slack chat.postMessage accepted the post but did not store message metadata; posting without the gateway marker, agent_accounts is the loop guard")
      }
      return reply
    } catch (error) {
      if (!this.marker || !(error instanceof SlackApiError) || !METADATA_REFUSED.test(error.error)) throw error
      this.marker = false
      this.options.log(`slack ${method} refused message metadata (${error.error}); posting without the gateway marker, agent_accounts is the loop guard`)
      return this.options.api.call(method, params)
    }
  }

  private async result(key: SurfaceKey, ts: string): Promise<SendResult> {
    this.options.directory.rememberMessage(key.chat_id, ts, key.thread_id)
    if (key.thread_id !== null) this.options.directory.rememberOwnThread(key.chat_id, key.thread_id)
    const self = await this.options.directory.self()
    return { message_id: ts, permalink: permalink(self, key.chat_id, ts, key.thread_id), created: null }
  }

  private async post(key: SurfaceKey, body: RichBody): Promise<SendResult> {
    await this.options.bucket.take(key.chat_id)
    const reply = await this.write("chat.postMessage", {
      channel: key.chat_id,
      ...messagePayload(body),
      unfurl_links: "false",
      unfurl_media: "false",
      thread_ts: key.thread_id ?? undefined,
    })
    if (!isTs(reply.ts)) throw new SlackApiError("chat.postMessage", "ok without a message ts")
    return this.result(key, reply.ts)
  }

  private async edit(key: SurfaceKey, message_id: string, body: RichBody): Promise<SendResult> {
    await this.options.bucket.take(key.chat_id)
    const reply = await this.write("chat.update", { channel: key.chat_id, ts: message_id, ...messagePayload(body) })
    if (reply.ts !== message_id) throw new SlackApiError("chat.update", `ok for ts ${String(reply.ts)}, not ${message_id}`)
    return this.result(key, message_id)
  }

  private async react(op: "react" | "unreact", key: SurfaceKey, message_id: string, name: string): Promise<void> {
    try {
      await this.options.api.call(op === "react" ? "reactions.add" : "reactions.remove", { channel: key.chat_id, timestamp: message_id, name: slackReaction(name) })
    } catch (error) {
      if (!(error instanceof SlackApiError) || !IDEMPOTENT.has(error.error)) throw error
    }
  }

  private async typing(key: SurfaceKey): Promise<void> {
    if (this.options.kind === "bot") {
      if (key.thread_id === null) throw new AdapterRefusal("typing", "typing", "a Slack app shows typing only inside a thread (assistant.threads.setStatus)")
      await this.options.api.call("assistant.threads.setStatus", { channel_id: key.chat_id, thread_ts: key.thread_id, status: "is typing..." })
      return
    }
    const frame = { type: "user_typing", channel: key.chat_id, ...(key.thread_id === null ? {} : { thread_ts: key.thread_id }) }
    const sent = await this.options.realtime.sendFrame(frame, this.options.typingBudgetMs)
    if (!sent) throw new SlackTypingUnavailable(`no realtime line within ${this.options.typingBudgetMs} ms`)
  }

  private async createChat(account_id: string, name: string, kind: "channel" | "topic" | "group", members: readonly string[]): Promise<SendResult> {
    if (kind === "topic") throw new AdapterRefusal("create_chat", "chat_create", "Slack has no topics; create a channel or a group")
    const reply = await this.options.api.call("conversations.create", { name: channelName(name), is_private: kind === "group" })
    const channel = isJson(reply.channel) && typeof reply.channel.id === "string" ? reply.channel.id : null
    if (channel === null) throw new SlackApiError("conversations.create", "ok without a channel id")
    if (members.length > 0) await this.options.api.call("conversations.invite", { channel, users: members.join(",") })
    return { message_id: "", permalink: "", created: { platform: "slack", account_id, chat_id: channel, thread_id: null } }
  }
}
