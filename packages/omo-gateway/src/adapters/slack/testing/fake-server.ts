import type { ServerWebSocket } from "bun"
import type { SurfaceKey } from "../../../adapter/contract"
import type { MethodContext, Reply } from "./fake-context"
import { callMethod } from "./fake-methods"
import {
  FAKE_ALICE,
  FAKE_APP_TOKEN,
  FAKE_BOT_ID,
  FAKE_BOT_TOKEN,
  FAKE_BOT_USER,
  FAKE_CHAT,
  FAKE_COOKIE,
  FAKE_SELF,
  FAKE_TEAM,
  FAKE_USER_TOKEN,
  FakeSlackState,
  type Caller,
  type FakeFile,
  type FakeMessage,
} from "./fake-state"

type SocketData = { kind: "rtm" | "socket" }
type Injected = { status?: number; error?: string; retryAfter?: number; hang?: boolean }
export type Call = { method: string; params: Record<string, string> }

export type HumanPost = {
  channel: string
  text: string
  thread_ts?: string
  user?: string
  bot_id?: string
  subtype?: string
  marker?: string
  ts?: string
  files?: readonly Omit<FakeFile, "shared">[]
}

/** A local Slack (Web API + RTM + Socket Mode) on `Bun.serve` port 0, for the adapter tests and the fake QA run. */
export class FakeSlackServer {
  readonly state = new FakeSlackState()
  readonly calls: Call[] = []
  readonly typingFrames: Record<string, unknown>[] = []
  readonly acks: string[] = []
  readonly counters: MethodContext["counters"] = { rtmConnects: 0, socketOpens: 0, statuses: [], hiddenShares: 0 }
  socketsOpened = 0
  peakOpenSockets = 0
  metadataFromUsers = false
  answerPings = true
  helloOnOpen = true
  readonly revoked = new Set<string>()
  private opens: (() => void)[] = []
  private frameWaiters: { ready: () => boolean; resolve: () => void }[] = []
  private readonly sockets = new Set<ServerWebSocket<SocketData>>()
  private readonly injected = new Map<string, Injected[]>()
  private readonly server: ReturnType<typeof Bun.serve<SocketData>>
  envelopesSent = 0

  constructor() {
    this.server = Bun.serve<SocketData>({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request, server) => this.handle(request, server),
      websocket: {
        open: (ws) => {
          this.sockets.add(ws)
          this.socketsOpened += 1
          this.peakOpenSockets = Math.max(this.peakOpenSockets, this.sockets.size)
          if (this.helloOnOpen) ws.send(JSON.stringify({ type: "hello" }))
          for (const opened of this.opens.splice(0)) opened()
        },
        message: (ws, raw) => this.clientFrame(ws, String(raw)),
        close: (ws) => {
          this.sockets.delete(ws)
        },
      },
    })
    this.state.origin = this.origin
  }

  get origin(): string {
    return `http://127.0.0.1:${this.server.port}`
  }

  get apiBase(): string {
    return `${this.origin}/api`
  }

  get openSockets(): number {
    return this.sockets.size
  }

  chat(account_id = FAKE_TEAM): SurfaceKey {
    return { platform: "slack", account_id, chat_id: FAKE_CHAT, thread_id: null }
  }

  /** The next call of `method` fails with this answer (FIFO per method). */
  failNext(method: string, answer: Injected): void {
    this.injected.set(method, [...(this.injected.get(method) ?? []), answer])
  }

  /** Resolves when the next realtime socket opens; subscribe before triggering the reconnect. */
  nextOpen(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>()
    this.opens.push(resolve)
    return promise
  }

  framesReceived(count: number): Promise<void> {
    return this.until(`${count} typing frames`, () => this.typingFrames.length >= count)
  }

  callsOf(method: string): Call[] {
    return this.calls.filter((call) => call.method === method)
  }

  private caller(request: Request): Caller | null {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "")
    if (this.revoked.has(token)) return null
    if (token === FAKE_USER_TOKEN) return request.headers.get("cookie") === `d=${FAKE_COOKIE}` ? { kind: "user", user: FAKE_SELF, bot_id: null } : null
    if (token === FAKE_BOT_TOKEN) return { kind: "bot", user: FAKE_BOT_USER, bot_id: FAKE_BOT_ID }
    if (token === FAKE_APP_TOKEN) return { kind: "app", user: "", bot_id: null }
    return null
  }

  private async handle(request: Request, server: Bun.Server<SocketData>): Promise<Response | undefined> {
    const path = new URL(request.url).pathname
    if (path === "/rtm" || path === "/socket") {
      if (path === "/rtm" && request.headers.get("cookie") !== `d=${FAKE_COOKIE}`) return new Response("no session cookie", { status: 401 })
      return server.upgrade(request, { data: { kind: path === "/rtm" ? "rtm" : "socket" } }) ? undefined : new Response("upgrade failed", { status: 400 })
    }
    const upload = /^\/upload\/(\w+)$/.exec(path)
    if (upload !== null) {
      const file = this.state.files.get(upload[1] ?? "")
      if (file === undefined) return new Response("no such upload", { status: 404 })
      file.bytes = new Uint8Array(await request.arrayBuffer())
      return new Response(`OK - ${file.bytes.byteLength}`)
    }
    const download = /^\/files\/(\w+)$/.exec(path)
    if (download !== null) {
      if (this.caller(request) === null) return new Response("forbidden", { status: 403 })
      const file = this.state.files.get(download[1] ?? "")
      return file === undefined ? new Response("gone", { status: 404 }) : new Response(file.bytes)
    }
    if (!path.startsWith("/api/")) return new Response("not found", { status: 404 })
    const method = path.slice("/api/".length)
    const params = new URLSearchParams(await request.text())
    this.calls.push({ method, params: Object.fromEntries(params) })
    const injected = this.injected.get(method)?.shift()
    if (injected !== undefined) {
      if (injected.hang === true) return new Promise<Response>(() => undefined)
      const headers = injected.retryAfter === undefined ? undefined : { "retry-after": String(injected.retryAfter) }
      return Response.json({ ok: false, error: injected.error ?? "ratelimited" }, { status: injected.status ?? 200, ...(headers === undefined ? {} : { headers }) })
    }
    const caller = this.caller(request)
    if (caller === null) return Response.json({ ok: false, error: "invalid_auth" })
    const reply: Reply = callMethod(method, {
      state: this.state,
      caller,
      params,
      origin: this.origin,
      metadataFromUsers: this.metadataFromUsers,
      broadcast: (event) => this.broadcast(event),
      counters: this.counters,
    })
    return Response.json(reply)
  }

  private clientFrame(ws: ServerWebSocket<SocketData>, raw: string): void {
    const frame: unknown = JSON.parse(raw)
    if (frame === null || typeof frame !== "object") return
    if ("envelope_id" in frame && typeof frame.envelope_id === "string") this.acks.push(frame.envelope_id)
    if ("type" in frame && frame.type === "ping" && "id" in frame && this.answerPings) ws.send(JSON.stringify({ type: "pong", reply_to: frame.id }))
    if ("type" in frame && frame.type === "user_typing") this.typingFrames.push({ ...frame })
    this.frameWaiters = this.frameWaiters.filter((waiter) => (waiter.ready() ? (waiter.resolve(), false) : true))
  }

  /** Resolves once `ready()` holds after a client frame (or already holds), or rejects after `ms`. */
  until(what: string, ready: () => boolean, ms = 5000): Promise<void> {
    if (ready()) return Promise.resolve()
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}`)), ms)
    this.frameWaiters.push({
      ready,
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
    })
    return promise
  }

  /** Deliver a Slack event to every realtime socket (RTM raw, Socket Mode wrapped in events_api). */
  broadcast(event: Record<string, unknown>): void {
    for (const ws of this.sockets) {
      if (ws.data.kind === "rtm") ws.send(JSON.stringify(event))
      else {
        this.envelopesSent += 1
        ws.send(JSON.stringify({ type: "events_api", envelope_id: `env-${this.envelopesSent}`, accepts_response_payload: false, payload: { type: "event_callback", team_id: FAKE_TEAM, event } }))
      }
    }
  }

  sendRaw(data: string): void {
    for (const ws of this.sockets) ws.send(data)
  }

  dropSockets(code = 1011): void {
    for (const ws of this.sockets) ws.close(code, "fake drop")
  }

  humanPost(input: HumanPost): FakeMessage {
    const files = (input.files ?? []).map((file) => ({ ...file, shared: null }))
    for (const file of files) this.state.files.set(file.id, file)
    const message = this.state.add({
      channel: input.channel,
      user: input.user ?? FAKE_ALICE,
      bot_id: input.bot_id ?? null,
      text: input.text,
      thread_ts: input.thread_ts ?? null,
      subtype: input.subtype ?? (files.length > 0 ? "file_share" : null),
      files,
      metadata: input.marker === undefined ? null : { event_type: input.marker, event_payload: {} },
      ...(input.ts === undefined ? {} : { ts: input.ts }),
    })
    this.broadcast({ ...this.state.json(message, true), channel: input.channel })
    return message
  }

  humanReact(channel: string, ts: string, name: string, user = FAKE_ALICE): void {
    const message = this.state.find(channel, ts)
    if (message !== undefined) message.reactions.set(name, new Set([...(message.reactions.get(name) ?? []), user]))
    this.broadcast({ type: "reaction_added", user, reaction: name, item: { type: "message", channel, ts }, item_user: message?.user ?? "", event_ts: this.state.nextTs() })
  }

  humanEdit(channel: string, ts: string, text: string): void {
    const message = this.state.find(channel, ts)
    if (message === undefined) throw new Error(`no message ${channel}:${ts}`)
    message.text = text
    message.edited = { user: message.user, ts: this.state.nextTs() }
    this.broadcast({ type: "message", subtype: "message_changed", channel, ts: this.state.nextTs(), message: this.state.json(message, true) })
  }

  /** Messages at `key` exactly: the chat's top level, or one thread's replies. */
  at(key: SurfaceKey): FakeMessage[] {
    return this.state.messages.filter((m) =>
      m.channel !== key.chat_id ? false : key.thread_id === null ? m.thread_ts === null || m.thread_ts === m.ts : m.thread_ts === key.thread_id && m.ts !== key.thread_id,
    )
  }

  stop(): void {
    this.server.stop(true)
  }
}
