// Slack surface adapter with two capability profiles:
// - `user`: a member's session token (xoxc + `d` cookie), realtime over RTM, typing frames on the
//   same RTM line; no buttons and no streaming (Slack answers not_allowed_token_type).
// - `bot`: a user-created Slack app (xoxb bot token + xapp app-level token), realtime over Socket
//   Mode, `stream_draft` via chat.startStream / appendStream / stopStream (threads only), typing via
//   assistant.threads.setStatus inside threads.
// `buttons` is false on both until a RenderedOp carries buttons; `thread_archive` is false because
// Slack threads cannot be archived. A rejected credential is a SlackAuthError (an AdapterFatal):
// the connector host stops and tells the scope owner once.
import type { Capabilities, InboundEvent, RenderedOp, SendResult, SurfaceAdapter, SurfaceKey } from "../../adapter/contract"
import { createTranscriber, type Transcriber } from "../../stt/transcribe"
import { AuthLatch, SlackApi } from "./api"
import { ChannelTokenBucket } from "./bucket"
import { realClock, type SlackClock } from "./clock"
import { SlackDirectory } from "./directory"
import { SlackHistory } from "./history"
import { SlackInbound } from "./inbound"
import { SlackOutbound, type TokenKind } from "./outbound"
import { REALTIME_TIMINGS, SlackRealtime, type Dialed, type RealtimeTimings } from "./realtime"
import { webSocketFactory, type SocketFactory } from "./socket"

const BASE: Capabilities = {
  edit: true,
  reactions: true,
  typing: true,
  threads: true,
  thread_archive: false,
  buttons: false,
  streaming: false,
  draft_stream: false,
  uploads: true,
  rich_links: true,
  presence: true,
  chat_create: true,
  max_text: 40_000,
}

export const SLACK_CAPABILITIES: Readonly<Record<TokenKind, Capabilities>> = {
  user: BASE,
  bot: { ...BASE, streaming: true, draft_stream: true, presence: false },
}

export type SlackAdapterOptions = {
  /** the workspace (team) id: `SurfaceKey.account_id`; auth.test must agree or the adapter stops */
  account_id: string
  token_kind: TokenKind
  /** `user`: the xoxc session token; `bot`: the xoxb bot token. Sent only in the Authorization header. */
  token: string
  /** `user` only: the `d` session cookie that goes with the xoxc token */
  cookie?: string
  /** `bot` only: the xapp app-level token that opens Socket Mode */
  app_token?: string
  /** chats catchUp reads; default every DM, group DM and joined channel */
  chats?: readonly string[]
  apiBase?: string
  fetch?: typeof fetch
  socket?: SocketFactory
  clock?: SlackClock
  transcriber?: Transcriber
  log?: (line: string) => void
  timings?: Partial<RealtimeTimings>
  typingBudgetMs?: number
  postsPerSecond?: number
  recentIds?: number
}

class RecentIds {
  private readonly ids = new Set<string>()
  constructor(private readonly limit: number) {}

  add(id: string): boolean {
    if (this.ids.has(id)) return false
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const oldest = this.ids.values().next()
      if (oldest.done !== true) this.ids.delete(oldest.value)
    }
    return true
  }
}

function requireSecret(value: string | undefined, what: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`slack adapter: the ${what} is missing`)
  return value
}

export class SlackAdapter implements SurfaceAdapter {
  readonly platform = "slack" as const
  readonly token_kind: TokenKind
  private readonly clock: SlackClock
  private readonly log: (line: string) => void
  private readonly api: SlackApi
  private readonly bucket: ChannelTokenBucket
  private readonly directory: SlackDirectory
  private readonly realtime: SlackRealtime
  private readonly inbound: SlackInbound
  private readonly outbound: SlackOutbound
  private readonly recentLimit: number

  constructor(options: SlackAdapterOptions) {
    this.token_kind = options.token_kind
    this.clock = options.clock ?? realClock
    this.log = options.log ?? ((line) => console.warn(line))
    this.recentLimit = options.recentIds ?? 4096
    const latch = new AuthLatch()
    const apiBase = (options.apiBase ?? "https://slack.com/api").replace(/\/+$/, "")
    const fetcher = options.fetch ?? fetch
    const user = options.token_kind === "user"
    const cookie = user ? requireSecret(options.cookie, "session cookie for the user token") : undefined
    this.api = new SlackApi({ token: options.token, ...(cookie === undefined ? {} : { cookie }), latch, apiBase, fetch: fetcher, clock: this.clock })
    const appApi = user ? null : new SlackApi({ token: requireSecret(options.app_token, "app-level token for Socket Mode"), latch, apiBase, fetch: fetcher, clock: this.clock })
    this.bucket = new ChannelTokenBucket(this.clock, options.postsPerSecond ?? 1)
    this.directory = new SlackDirectory(this.api, latch, options.account_id, this.log)
    const dial = async (): Promise<Dialed> => {
      const reply = appApi === null ? await this.api.call("rtm.connect") : await appApi.call("apps.connections.open")
      if (typeof reply.url !== "string" || reply.url === "") throw new Error(`slack ${user ? "rtm.connect" : "apps.connections.open"} returned no url`)
      return { url: reply.url, headers: cookie === undefined ? {} : { Cookie: `d=${cookie}` } }
    }
    this.realtime = new SlackRealtime({
      profile: user ? "rtm" : "socket_mode",
      dial,
      socket: options.socket ?? webSocketFactory,
      clock: this.clock,
      latch,
      log: this.log,
      timings: { ...REALTIME_TIMINGS, ...options.timings },
    })
    const history = new SlackHistory({ api: this.api, log: this.log, canSearch: user })
    const transcriber = options.transcriber ?? createTranscriber({ stt: undefined, log: this.log })
    this.inbound = new SlackInbound({ account_id: options.account_id, api: this.api, directory: this.directory, history, transcriber, log: this.log, chats: options.chats ?? null })
    this.outbound = new SlackOutbound({
      kind: options.token_kind,
      account_id: options.account_id,
      api: this.api,
      bucket: this.bucket,
      clock: this.clock,
      directory: this.directory,
      realtime: this.realtime,
      capabilities: SLACK_CAPABILITIES[options.token_kind],
      typingBudgetMs: options.typingBudgetMs ?? 2500,
      log: this.log,
    })
  }

  capabilities(): Capabilities {
    return { ...SLACK_CAPABILITIES[this.token_kind] }
  }

  async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    if (signal.aborted) return
    await this.directory.self()
    const recent = new RecentIds(this.recentLimit)
    let queue = Promise.resolve()
    let lastAt = this.clock.now()
    const emit = (event: InboundEvent | null) => {
      if (event === null || !recent.add(event.event_id)) return
      lastAt = Math.max(lastAt, Date.parse(event.at))
      onEvent(event)
    }
    const enqueue = (step: () => Promise<void> | void) => {
      queue = queue.then(step).catch((error: unknown) => this.log(`slack adapter: ${error instanceof Error ? error.message : String(error)}`))
    }
    const recoverGap = async (sinceMs: number) => {
      for await (const event of this.inbound.catchUp(new Date(sinceMs).toISOString(), [])) emit(event)
    }
    try {
      await this.realtime.run(signal, {
        event: (type, data) => enqueue(async () => emit(await this.inbound.realtime(type, data))),
        connected: (first) => {
          if (first) enqueue(ready)
          else {
            const since = lastAt
            enqueue(() => recoverGap(since))
          }
        },
      })
    } finally {
      await queue
    }
  }

  catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    return this.inbound.catchUp(since, threads)
  }

  send(op: RenderedOp): Promise<SendResult> {
    return this.outbound.send(op)
  }

  /** Close a typing-only realtime line now instead of after its idle period. */
  close(): void {
    this.realtime.close()
  }
}
