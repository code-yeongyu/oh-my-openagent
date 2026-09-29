// The contract's `stream_draft` op on the Slack app-token profile. The first draft of a reply opens
// a stream (chat.startStream), each later draft appends the text added since the previous one
// (chat.appendStream), and the final op closes it (chat.stopStream). Slack streams are append-only:
// a draft that rewrites earlier text is not shown, and a final text that does not extend what was
// shown replaces the message text with chat.update. Slack streams only inside a thread, and a stream
// in a channel thread needs the person it answers: the thread root's author, else the latest person
// who replied there.
import { AdapterRefusal, type RenderedOp, type RichBody, type SendResult, type SurfaceKey } from "../../adapter/contract"
import { SlackApiError, type SlackApi } from "./api"
import type { ChannelTokenBucket } from "./bucket"
import type { SlackDirectory } from "./directory"
import { isDirectChannel } from "./events"
import { isJson, isTs } from "./wire"

type StreamDraftOp = Extract<RenderedOp, { op: "stream_draft" }>
type Live = { channel: string; ts: string; shown: string }

export type DraftDeps = {
  api: SlackApi
  bucket: ChannelTokenBucket
  directory: SlackDirectory
  account_id: string
  post(key: SurfaceKey, body: RichBody): Promise<SendResult>
  edit(key: SurfaceKey, message_id: string, body: RichBody): Promise<SendResult>
  result(key: SurfaceKey, ts: string): Promise<SendResult>
}

const NOTHING: SendResult = { message_id: "", permalink: "", created: null }
const REPLIES_FOR_RECIPIENT = 50
const textBody = (text: string): RichBody => [{ t: "text", text }]

export class SlackDraftStreams {
  private readonly live = new Map<string, Live>()

  constructor(private readonly deps: DraftDeps) {}

  async send(op: StreamDraftOp): Promise<SendResult> {
    const { key } = op
    const thread = key.thread_id
    if (thread === null) throw new AdapterRefusal(op.op, "draft_stream", "Slack streams replies only inside a thread; post at the chat top level instead")
    const id = `${key.chat_id}:${thread}:${op.draft_id}`
    const live = this.live.get(id)
    if (!op.final) {
      if (live === undefined) this.live.set(id, await this.start(key.chat_id, thread, op.text))
      else await this.append(live, op.text)
      return NOTHING
    }
    this.live.delete(id)
    if (live === undefined) return this.deps.post(key, textBody(op.text))
    const extendsShown = op.text.startsWith(live.shown)
    const rest = extendsShown ? op.text.slice(live.shown.length) : ""
    await this.deps.api.call("chat.stopStream", { channel: live.channel, ts: live.ts, markdown_text: rest === "" ? undefined : rest })
    this.deps.directory.rememberMessage(live.channel, live.ts, thread)
    this.deps.directory.rememberOwnThread(live.channel, thread)
    return extendsShown ? this.deps.result(key, live.ts) : this.deps.edit(key, live.ts, textBody(op.text))
  }

  private async start(channel: string, thread: string, text: string): Promise<Live> {
    const recipient = isDirectChannel(channel) ? null : await this.recipient(channel, thread)
    await this.deps.bucket.take(channel)
    const started = await this.deps.api.call("chat.startStream", {
      channel,
      thread_ts: thread,
      recipient_user_id: recipient ?? undefined,
      recipient_team_id: recipient === null ? undefined : this.deps.account_id,
      markdown_text: text === "" ? undefined : text,
    })
    if (!isTs(started.ts)) throw new SlackApiError("chat.startStream", "ok without a stream ts")
    return { channel, ts: started.ts, shown: text }
  }

  private async append(live: Live, text: string): Promise<void> {
    if (!text.startsWith(live.shown) || text.length === live.shown.length) return
    await this.deps.api.call("chat.appendStream", { channel: live.channel, ts: live.ts, markdown_text: text.slice(live.shown.length) })
    live.shown = text
  }

  private async recipient(channel: string, thread: string): Promise<string> {
    const self = await this.deps.directory.self()
    const reply = await this.deps.api.call("conversations.replies", { channel, ts: thread, limit: REPLIES_FOR_RECIPIENT })
    const messages: unknown[] = Array.isArray(reply.messages) ? reply.messages : []
    const person = (message: unknown): string | null =>
      isJson(message) && typeof message.user === "string" && message.user !== self.user_id && message.bot_id === undefined ? message.user : null
    const chosen = person(messages[0]) ?? messages.map(person).findLast((user) => user !== null) ?? null
    if (chosen === null) {
      throw new AdapterRefusal("stream_draft", "draft_stream", "a Slack stream in a channel thread answers a person, and no person has posted in this thread")
    }
    return chosen
  }
}
