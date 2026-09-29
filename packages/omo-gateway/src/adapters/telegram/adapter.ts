// Telegram bot adapter. `buttons` is false because no RenderedOp carries buttons; `chat_create` is
// false because bots cannot create chats (topics are threads: open_thread); `presence` is false
// because the Bot API has no presence. Streaming is the `stream_draft` op (sendMessageDraft; the
// `final` op posts the finished message).
import { checkCapability } from "../../adapter/capability"
import type { Capabilities, InboundEvent, RenderedOp, SendResult, SurfaceAdapter, SurfaceKey } from "../../adapter/contract"
import { createTranscriber, type Transcriber } from "../../stt/transcribe"
import { TelegramApi, type Clock } from "./api"
import { TelegramSender } from "./outbound"
import { TelegramPoller } from "./poller"
import { TELEGRAM_LIMITS, TelegramRateLimiter, type TelegramLimits } from "./rate"
import { DEFAULT_RETENTION, TelegramStateFile, type JournalRetention } from "./state"

export const TELEGRAM_CAPABILITIES: Capabilities = {
  edit: true,
  reactions: true,
  typing: true,
  threads: true,
  thread_archive: true,
  buttons: false,
  streaming: true,
  draft_stream: true,
  uploads: true,
  rich_links: true,
  presence: false,
  chat_create: false,
  max_text: 4096,
}

export type TelegramAdapterOptions = {
  /** the bot token `<bot id>:<secret>`; never logged, never put in an event */
  token: string
  /** the gateway account id; defaults to the bot id in the token */
  account_id?: string
  /** the 0600 file holding the getUpdates cursors and the handled event ids (no message text) */
  statePath: string
  apiBase?: string
  fetch?: typeof fetch
  clock?: Clock
  transcribe?: Transcriber
  /** user-facing stop notices (409 conflict, rejected token); each fires at most once */
  notice?: (text: string) => void
  log?: (line: string) => void
  /** long-poll timeout in seconds; default 50 */
  pollTimeoutSec?: number
  limits?: Partial<TelegramLimits>
  journal?: Partial<JournalRetention>
}

export class TelegramAdapter implements SurfaceAdapter {
  readonly platform = "telegram"
  readonly account_id: string
  private readonly sender: TelegramSender
  private readonly poller: TelegramPoller

  constructor(options: TelegramAdapterOptions) {
    const api = new TelegramApi({ token: options.token, apiBase: options.apiBase, fetch: options.fetch, clock: options.clock })
    this.account_id = options.account_id ?? options.token.split(":")[0] ?? ""
    const log = options.log ?? ((line: string) => console.warn(line))
    this.sender = new TelegramSender(api, new TelegramRateLimiter(api.clock, { ...TELEGRAM_LIMITS, ...options.limits }))
    this.poller = new TelegramPoller({
      api,
      account_id: this.account_id,
      state: new TelegramStateFile(options.statePath, { ...DEFAULT_RETENTION, ...options.journal }),
      transcribe: options.transcribe ?? createTranscriber({ stt: undefined, log }),
      notice: options.notice ?? ((text: string) => console.error(text)),
      log,
      pollTimeoutSec: options.pollTimeoutSec ?? 50,
    })
  }

  capabilities(): Capabilities {
    return { ...TELEGRAM_CAPABILITIES }
  }

  listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    return this.poller.listen(onEvent, signal, ready)
  }

  catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    return this.poller.catchUp(since, threads)
  }

  async send(op: RenderedOp): Promise<SendResult> {
    const refusal = checkCapability(this.platform, TELEGRAM_CAPABILITIES, op)
    if (refusal !== null) throw refusal
    return this.sender.send(op)
  }
}
