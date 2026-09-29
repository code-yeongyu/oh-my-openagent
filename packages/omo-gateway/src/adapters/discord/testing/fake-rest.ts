import { isJson } from "../wire"
import { FAKE_BOT, type FakeAttachment, type FakeDiscordState, type FakeMessage } from "./fake-state"

export type RecordedRequest = { method: string; path: string; authorization: string }
type Emit = (t: string, d: unknown) => void
type Route = { method: string; pattern: RegExp; handle: (match: string[], request: Request) => Promise<Response> }

const notFound = () => Response.json({ message: "Unknown", code: 10003 }, { status: 404 })

/** Discord REST v10 routes the adapter uses, over FakeDiscordState, emitting the gateway events Discord would. */
export class FakeDiscordRest {
  readonly requests: RecordedRequest[] = []
  private pending429: number[] = []
  private readonly routes: Route[]

  constructor(
    private readonly state: FakeDiscordState,
    private readonly token: string,
    private readonly origin: () => string,
    private readonly emit: Emit,
  ) {
    const channel = "/channels/(\\d+)"
    const message = `${channel}/messages/(\\d+)`
    this.routes = [
      { method: "GET", pattern: new RegExp(`^${channel}$`), handle: async ([id = ""]) => this.getChannel(id) },
      { method: "PATCH", pattern: new RegExp(`^${channel}$`), handle: async ([id = ""], request) => this.patchChannel(id, await request.json()) },
      { method: "GET", pattern: new RegExp(`^${channel}/messages$`), handle: async ([id = ""], request) => this.history(id, new URL(request.url)) },
      { method: "POST", pattern: new RegExp(`^${channel}/messages$`), handle: async ([id = ""], request) => this.create(id, request) },
      { method: "PATCH", pattern: new RegExp(`^${message}$`), handle: async ([ch = "", id = ""], request) => this.edit(ch, id, await request.json()) },
      { method: "PUT", pattern: new RegExp(`^${message}/reactions/([^/]+)/@me$`), handle: async ([, id = "", emoji = ""]) => this.react(id, emoji, true) },
      { method: "DELETE", pattern: new RegExp(`^${message}/reactions/([^/]+)/@me$`), handle: async ([, id = "", emoji = ""]) => this.react(id, emoji, false) },
      { method: "POST", pattern: new RegExp(`^${channel}/typing$`), handle: async () => new Response(null, { status: 204 }) },
      { method: "POST", pattern: new RegExp(`^${message}/threads$`), handle: async ([ch = "", id = ""], request) => this.thread(ch, id, await request.json()) },
      { method: "POST", pattern: /^\/guilds\/(\d+)\/channels$/, handle: async ([guild = ""], request) => this.createChannel(guild, await request.json()) },
    ]
  }

  /** The next `count` API requests answer 429 with `retry_after` seconds. */
  rateLimitNext(count: number, retryAfter: number): void {
    this.pending429 = Array.from({ length: count }, () => retryAfter)
  }

  async handle(request: Request, path: string): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? ""
    this.requests.push({ method: request.method, path, authorization })
    if (authorization !== `Bot ${this.token}`) return Response.json({ message: "401: Unauthorized", code: 0 }, { status: 401 })
    const retryAfter = this.pending429.shift()
    if (retryAfter !== undefined) return Response.json({ message: "You are being rate limited.", retry_after: retryAfter, global: false }, { status: 429 })
    for (const route of this.routes) {
      const match = route.method === request.method ? route.pattern.exec(path) : null
      if (match !== null) return route.handle(match.slice(1), request)
    }
    return notFound()
  }

  attachment(message_id: string, attachment_id: string): Response {
    const found = this.state.messages.get(message_id)?.attachments.find((attachment) => attachment.id === attachment_id)
    return found === undefined ? notFound() : new Response(found.bytes, { headers: { "content-type": found.content_type } })
  }

  publish(message: FakeMessage): void {
    this.emit("MESSAGE_CREATE", this.state.messageJson(message, this.origin(), true))
  }

  private getChannel(id: string): Response {
    const channel = this.state.channels.get(id)
    return channel === undefined ? notFound() : Response.json(this.state.channelJson(channel))
  }

  private patchChannel(id: string, body: unknown): Response {
    const channel = this.state.channels.get(id)
    if (channel === undefined) return notFound()
    if (isJson(body) && typeof body.archived === "boolean") channel.archived = body.archived
    this.emit("THREAD_UPDATE", this.state.channelJson(channel))
    return Response.json(this.state.channelJson(channel))
  }

  private history(id: string, url: URL): Response {
    if (!this.state.channels.has(id)) return notFound()
    const after = BigInt(url.searchParams.get("after") ?? "0")
    const limit = Number(url.searchParams.get("limit") ?? "50")
    const page = this.state
      .inChannel(id)
      .filter((message) => BigInt(message.id) > after)
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .slice(0, limit)
      .reverse()
    return Response.json(page.map((message) => this.state.messageJson(message, this.origin(), false)))
  }

  private async create(channel_id: string, request: Request): Promise<Response> {
    if (!this.state.channels.has(channel_id)) return notFound()
    const multipart = (request.headers.get("content-type") ?? "").startsWith("multipart/form-data")
    let payload: unknown
    const attachments: FakeAttachment[] = []
    if (multipart) {
      const form = await request.formData()
      payload = JSON.parse(String(form.get("payload_json") ?? "{}"))
      const described = isJson(payload) && Array.isArray(payload.attachments) ? payload.attachments : []
      for (const entry of described) {
        if (!isJson(entry) || typeof entry.id !== "number") continue
        const file = form.get(`files[${entry.id}]`)
        if (!(file instanceof File)) continue
        attachments.push({ id: this.state.snowflake(), filename: typeof entry.filename === "string" ? entry.filename : file.name, content_type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
      }
    } else payload = await request.json()
    const content = isJson(payload) && typeof payload.content === "string" ? payload.content : ""
    if (content.length > 2000) return Response.json({ message: "Invalid Form Body", code: 50035 }, { status: 400 })
    const message = this.state.addMessage({ channel_id, author: FAKE_BOT, content, attachments })
    this.publish(message)
    return Response.json(this.state.messageJson(message, this.origin(), false))
  }

  private edit(channel_id: string, id: string, body: unknown): Response {
    const message = this.state.messages.get(id)
    if (message === undefined || message.channel_id !== channel_id) return notFound()
    if (message.author.id !== FAKE_BOT.id) return Response.json({ message: "Cannot edit a message authored by another user", code: 50005 }, { status: 403 })
    if (isJson(body) && typeof body.content === "string") message.content = body.content
    this.emit("MESSAGE_UPDATE", this.state.messageJson(message, this.origin(), true))
    return Response.json(this.state.messageJson(message, this.origin(), false))
  }

  private react(id: string, encoded: string, on: boolean): Response {
    const message = this.state.messages.get(id)
    if (message === undefined) return notFound()
    const emoji = decodeURIComponent(encoded)
    const users = message.reactions.get(emoji) ?? new Set<string>()
    if (on) users.add(FAKE_BOT.id)
    else users.delete(FAKE_BOT.id)
    message.reactions.set(emoji, users)
    return new Response(null, { status: 204 })
  }

  private thread(channel_id: string, message_id: string, body: unknown): Response {
    const parent = this.state.channels.get(channel_id)
    const root = this.state.messages.get(message_id)
    if (parent === undefined || root === undefined) return notFound()
    const name = isJson(body) && typeof body.name === "string" ? body.name : "thread"
    const thread = this.state.addChannel({ type: 11, guild_id: parent.guild_id, parent_id: parent.id, name })
    root.thread = thread.id
    this.emit("THREAD_CREATE", { ...this.state.channelJson(thread), newly_created: true })
    return Response.json(this.state.channelJson(thread))
  }

  private createChannel(guild_id: string, body: unknown): Response {
    const name = isJson(body) && typeof body.name === "string" ? body.name : "channel"
    const channel = this.state.addChannel({ type: 0, guild_id, parent_id: null, name })
    this.emit("CHANNEL_CREATE", this.state.channelJson(channel))
    return Response.json(this.state.channelJson(channel))
  }
}
