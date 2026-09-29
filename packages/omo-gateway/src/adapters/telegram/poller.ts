// getUpdates long-poll (never webhooks: the machine opens no inbound port). One poller per
// adapter instance; catchUp never issues a second concurrent getUpdates while listen is polling,
// because Telegram answers a concurrent poll with 409. The offset is persisted after the events
// of a batch were handed to the caller, so a crash re-delivers at most that batch (same
// event_ids, which the connector dedupes) and never skips one. Event text stays in memory (this
// instance's `recent` ring); the state file keeps ids and cursors only.
import type { InboundEvent, SurfaceKey } from "../../adapter/contract"
import { voiceFields, type Transcriber } from "../../stt/transcribe"
import { TelegramAuthError, TelegramConflictError, type TelegramApi } from "./api"
import { toInboundDrafts, type BotIdentity, type InboundDraft } from "./inbound"
import type { TelegramState, TelegramStateFile } from "./state"
import { parseUpdate } from "./wire"

const ALLOWED_UPDATES = ["message", "edited_message", "message_reaction"]
const MAX_BACKOFF_MS = 60_000

export type PollerOptions = {
  api: TelegramApi
  account_id: string
  state: TelegramStateFile
  transcribe: Transcriber
  notice: (text: string) => void
  log: (line: string) => void
  pollTimeoutSec: number
}

type Loaded = { state: TelegramState; bot: BotIdentity }
type Batch = { requested: number; offset: number; events: InboundEvent[]; changed: boolean }

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class TelegramPoller {
  private loaded: Promise<Loaded> | null = null
  private recent: InboundEvent[] = []
  private polling = false
  private fatal: Error | null = null

  constructor(private readonly options: PollerOptions) {}

  private load(): Promise<Loaded> {
    this.loaded ??= (async () => {
      const { state, api, log } = this.options
      const saved = await state.load((reason) => log(`telegram state ${state.path}: ${reason}; starting from the pending updates`))
      const me = await api.call<{ id?: unknown; username?: unknown }>("getMe")
      const id = typeof me.id === "number" ? me.id : Number(this.options.account_id)
      return { state: saved, bot: { id, username: typeof me.username === "string" ? me.username : null } }
    })()
    this.loaded.catch(() => {
      this.loaded = null
    })
    return this.loaded
  }

  private stop(error: TelegramConflictError | TelegramAuthError): never {
    if (this.fatal === null) {
      this.fatal = error
      const why =
        error instanceof TelegramConflictError
          ? `another poller or a webhook owns this bot (${error.description}); stop the other poller or delete the webhook, then restart the connector`
          : `the bot token was rejected (${error.description}); replace the credential, then restart the connector`
      this.options.notice(`Telegram connector for bot ${this.options.account_id} stopped: ${why}.`)
    }
    throw this.fatal
  }

  private async resolveVoice(draft: InboundDraft): Promise<InboundEvent> {
    if (draft.voice === null) return draft.event
    const { api, transcribe, log } = this.options
    try {
      const file = await api.call<{ file_path?: unknown }>("getFile", { file_id: draft.voice.file_id })
      if (typeof file.file_path !== "string") throw new Error("getFile returned no file_path")
      const bytes = await api.download(file.file_path)
      return { ...draft.event, ...voiceFields(draft.event.text, await transcribe(bytes, file.file_path.split("/").pop() ?? "voice.oga")) }
    } catch (error) {
      log(`telegram voice ${draft.event.event_id}: ${api.redact(message(error))}`)
      return { ...draft.event, ...voiceFields(draft.event.text, { unavailable: "download failed" }) }
    }
  }

  private async pollOnce(from: "offset" | "confirmed", timeoutSec: number, signal: AbortSignal): Promise<Batch> {
    const { state, bot } = await this.load()
    const { api, log, account_id } = this.options
    const requested = state[from]
    const request = { offset: requested, timeout: timeoutSec, allowed_updates: ALLOWED_UPDATES }
    const raw = await api.call<unknown>("getUpdates", request, AbortSignal.any([signal, AbortSignal.timeout((timeoutSec + 15) * 1000)]))
    if (!Array.isArray(raw)) {
      log("telegram getUpdates returned a non-array result; skipped")
      return { requested, offset: state.offset, events: [], changed: false }
    }
    let offset = state.offset
    const events: InboundEvent[] = []
    for (const entry of raw) {
      const update = parseUpdate(entry)
      if (update === null) {
        log("telegram getUpdates entry without an update_id; skipped")
        continue
      }
      offset = Math.max(offset, update.update_id + 1)
      for (const draft of toInboundDrafts(update, account_id, bot)) events.push(await this.resolveVoice(draft))
    }
    return { requested, offset, events, changed: raw.length > 0 }
  }

  private async commit(batch: Batch, delivered: readonly InboundEvent[]): Promise<void> {
    const loaded = await this.load()
    const { state, api } = this.options
    const now = api.clock.now()
    const seen = state.prune([...loaded.state.seen, ...delivered.map(({ event_id, at }) => ({ event_id, at }))], now)
    this.recent = state.prune([...this.recent, ...delivered], now)
    const confirmed = Math.max(loaded.state.confirmed, batch.requested)
    loaded.state = { offset: Math.max(loaded.state.offset, batch.offset), confirmed, seen }
    if (batch.changed) await state.save(loaded.state)
  }

  private classify(error: unknown): void {
    if (error instanceof TelegramConflictError || error instanceof TelegramAuthError) this.stop(error)
  }

  async listen(onEvent: (e: InboundEvent) => void, signal: AbortSignal, ready: () => void): Promise<void> {
    if (this.fatal !== null) throw this.fatal
    if (this.polling) throw new Error("telegram adapter is already listening")
    this.polling = true
    let live = false
    let backoff = 1000
    try {
      while (!signal.aborted) {
        let batch: Batch
        try {
          batch = await this.pollOnce("offset", live ? this.options.pollTimeoutSec : 0, signal)
        } catch (error) {
          if (signal.aborted) break
          this.classify(error)
          this.options.log(`telegram getUpdates failed: ${this.options.api.redact(message(error))}; retrying in ${backoff} ms`)
          await this.options.api.clock.sleep(backoff, signal).catch(() => undefined)
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
          continue
        }
        backoff = 1000
        for (const event of batch.events) onEvent(event)
        await this.commit(batch, batch.events)
        if (!live) {
          live = true
          ready()
        }
      }
    } finally {
      this.polling = false
    }
  }

  /**
   * Events after `since`: first what this instance already delivered (memory), then what Telegram
   * still holds from the last confirmed offset on (the unconfirmed tail and whatever arrived while
   * the adapter was down). A held update whose event_id is in the persisted `seen` ids is a replay
   * under its original event_id; any other is fresh, recorded, and moves the offset.
   */
  async *catchUp(since: string, threads: readonly SurfaceKey[]): AsyncIterable<InboundEvent> {
    if (this.fatal !== null) throw this.fatal
    const loaded = await this.load()
    const watched = new Set(threads.map((key) => `${key.chat_id}/${key.thread_id}`))
    const after = Date.parse(since)
    const matches = (event: InboundEvent) =>
      Date.parse(event.at) > after && (event.key.thread_id === null || event.kind === "mention" || watched.has(`${event.key.chat_id}/${event.key.thread_id}`))
    const out = this.recent.filter(matches)
    const yielded = new Set(out.map((event) => event.event_id))
    if (!this.polling) {
      try {
        const batch = await this.pollOnce("confirmed", 0, new AbortController().signal)
        const seen = new Set(loaded.state.seen.map((entry) => entry.event_id))
        const fresh = batch.events.filter((event) => !seen.has(event.event_id) && !yielded.has(event.event_id))
        for (const event of batch.events) {
          if (yielded.has(event.event_id)) continue
          if (fresh.includes(event) || matches(event)) out.push(event)
          yielded.add(event.event_id)
        }
        await this.commit(batch, fresh)
      } catch (error) {
        this.classify(error)
        throw error
      }
    }
    yield* out
  }
}
