import { LocalApiError, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import type { HeldAttach } from "./attach-pool"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionState, RemoteSessionWatch, RemoteWatchEnd, RemoteWatchHandlers, RemoteWatchOutcome } from "./ports"
import { ACCESS_ENDED, ACCESS_REFUSED, causeOf, isJsonObject, nonEmpty, SESSION_GONE, SESSION_LEFT, sessionStateOf, statusOf } from "./session-state"
import { WatchQueue, type WatchItem } from "./watch-queue"

export type WatchLink = {
  readonly hold: (device: string, sessionId: string) => Promise<HeldAttach>
  /** A fresh `get_state` of the session, through the device (never the attach's mirror). */
  readonly getState: (device: string, sessionId: string) => Promise<RemoteCommandOutcome>
  /** The listing key the session with this durable engine id is served under now; rejects when its device has none. */
  readonly locate: (device: string, durableSessionId: string) => Promise<string>
  readonly delay: (ms: number) => Promise<void>
}

type AttachEvent = Parameters<Parameters<RemoteAttach["onEvent"]>[0]>[0]
type StateRead = { readonly kind: "ok"; readonly state: RemoteSessionState } | { readonly kind: "failed"; readonly reason: string }

// Re-attach backoff after the attach or the device service went away: 1 s doubling to 30 s (senpi's RPC_RESCAN_MS).
const RETRY_FIRST_MS = 1_000
const RETRY_MAX_MS = 30_000
const SETTLED_KEPT = 256

const codeOf = (error: unknown): string | undefined => (error instanceof LocalApiError ? error.code : undefined)

class SessionWatch {
  #key: string
  #held: HeldAttach | undefined
  #unsubscribe: (() => void) | undefined
  #attachId: number | undefined
  #lastSeq = 0
  #status: string | undefined
  #durable: string | undefined
  #runningTurn: string | undefined
  #sawStatusRecord = false
  readonly #settled: string[] = []
  readonly #queue = new WatchQueue((item) => this.#process(item))
  #lostReported = false
  #leftReason: "session_closed" | "session_replaced" | undefined
  #done = false
  #resolveEnded!: (end: RemoteWatchEnd) => void
  readonly ended = new Promise<RemoteWatchEnd>((resolve) => { this.#resolveEnded = resolve })

  constructor(readonly link: WatchLink, readonly device: string, sessionId: string, readonly handlers: RemoteWatchHandlers) {
    this.#key = sessionId
  }

  async start(baseline: boolean): Promise<RemoteWatchOutcome> {
    try {
      await this.#attach()
    } catch (error) {
      this.#finish("stopped")
      return { kind: "refused", reason: codeOf(error) ?? "attach_failed" }
    }
    let initial: RemoteSessionState | undefined
    if (baseline) {
      const read = await this.#readState()
      if (read.kind !== "ok") {
        this.#finish("stopped")
        return { kind: "refused", reason: read.reason }
      }
      initial = read.state
      this.#adopt(initial)
    }
    const watch: RemoteSessionWatch = { ended: this.ended, stop: () => this.#finish("stopped"), ...(initial === undefined ? {} : { initial }) }
    return { kind: "ok", watch }
  }

  async #attach(): Promise<void> {
    const held = await this.link.hold(this.device, this.#key)
    if (this.#done) return held.release()
    this.#held = held
    // onEvent replays the attach's history (its latest snapshot and the records after it) before it returns: that
    // history only positions the watch; what arrives after it is live. The attach's FIRST snapshot positions it too,
    // replayed or not: the relay sends it after session.attach answers (a re-attach resyncs on its own).
    this.#attachId = undefined
    let replaying = true
    this.#unsubscribe = held.session.attached.onEvent((event) => this.#accept(event, replaying))
    replaying = false
    void held.session.attached.detached.then((reason) => { if (this.#held === held) this.#queue.push({ kind: "ended", reason }) })
  }

  #accept(event: AttachEvent, replaying: boolean): void {
    if (event.kind === "snapshot") {
      this.#durable = nonEmpty(event.snapshot.state["durableSessionId"]) ?? this.#durable
      if (!replaying && this.#attachId !== undefined) return this.#queue.push({ kind: "snapshot", attachId: event.snapshot.attach_id })
      this.#attachId = event.snapshot.attach_id
      this.#lastSeq = 0
    } else if (event.kind === "records") {
      if (replaying) this.#lastSeq = Math.max(this.#lastSeq, ...(event.seqs ?? []))
      else this.#queue.push({ kind: "records", attachId: event.attach_id, records: event.records, ...(event.seqs === undefined ? {} : { seqs: event.seqs }) })
    }
  }

  async #process(item: WatchItem): Promise<void> {
    switch (item.kind) {
      case "records":
        if (item.attachId !== this.#attachId) {
          this.#attachId = item.attachId
          this.#lastSeq = 0
        }
        for (const [index, record] of item.records.entries()) {
          const seq = item.seqs?.[index]
          if (seq !== undefined && seq <= this.#lastSeq) continue
          if (seq !== undefined) this.#lastSeq = seq
          if (!this.#apply(record)) return
        }
        return
      case "snapshot":
        this.#attachId = item.attachId
        this.#lastSeq = 0
        return await this.#resync(false)
      case "resync":
        return await this.#resync(false)
      case "ended":
        return await this.#onAttachEnded(item.reason)
    }
  }

  #apply(record: JsonObject): boolean {
    const type = record["type"]
    if (type === "agent_settled") {
      const turn = nonEmpty(record["turnId"]) ?? this.#runningTurn
      if (turn !== undefined && this.#settled.includes(turn)) return true
      if (turn !== undefined) this.#markSettled(turn)
      this.#runningTurn = undefined
    }
    if (type === "agent_start" || type === "turn_start") this.#runningTurn = nonEmpty(record["turnId"]) ?? this.#runningTurn
    if (type === "session_status") this.#durable = nonEmpty(record["durableSessionId"]) ?? this.#durable
    if (!this.#deliver(() => this.handlers.record(record))) return false
    const next = statusOf(record, this.#sawStatusRecord)
    if (type === "session_status") this.#sawStatusRecord = true
    if (next === undefined || next === this.#status) return true
    const from = this.#status
    this.#status = next
    const cause = type === "session_status" ? causeOf(record) : nonEmpty(type)
    return this.#deliver(() => this.handlers.status?.({ from, to: next, derived: type !== "session_status", ...(cause === undefined ? {} : { cause }) }))
  }

  async #resync(restarted: boolean): Promise<void> {
    const outcome = await this.#resyncOnce(restarted)
    if (outcome !== "done") await this.#reattach(outcome.reason, restarted, true)
  }

  // One fresh read and its report. A read the device refused for any reason but the session being gone is handed back:
  // the caller retries it under the same backoff as a failed attach (the attach itself may be fine and re-hold at once).
  async #resyncOnce(restarted: boolean): Promise<"done" | { readonly reason: string }> {
    const read = await this.#readState()
    if (this.#done) return "done"
    if (read.kind !== "ok") {
      if (!SESSION_GONE.has(read.reason)) return { reason: read.reason }
      if (restarted) this.#finish(this.#leftReason ?? "session_closed")
      else await this.#relocate("session_closed")
      return "done"
    }
    this.#lostReported = false
    const { state } = read
    const from = this.#status
    const turn = this.#runningTurn
    const settledTurns = turn !== undefined && !(state.status === "running" && state.currentTurnId === turn) && !this.#settled.includes(turn) ? [turn] : []
    for (const settled of settledTurns) this.#markSettled(settled)
    this.#adopt(state)
    this.#deliver(() => this.handlers.resynced?.({ from, state, settledTurns, restarted }))
    return "done"
  }

  async #onAttachEnded(reason: string): Promise<void> {
    this.#release()
    if (ACCESS_ENDED.has(reason)) return this.#finish(`access:${reason}`)
    if (SESSION_LEFT.has(reason)) return await this.#relocate(reason === "session_replaced" ? "session_replaced" : "session_closed")
    await this.#reattach(reason)
  }

  // The engine let the session go (a restart relists it under a new key, or it really closed): find it again by its
  // durable id, else the watch ends with the reason the attach gave.
  async #relocate(reason: "session_closed" | "session_replaced"): Promise<void> {
    this.#release()
    this.#leftReason = reason
    const durable = this.#durable
    if (durable === undefined) return this.#finish(reason)
    try {
      this.#key = await this.link.locate(this.device, durable)
    } catch {
      return this.#finish(reason)
    }
    await this.#reattach(undefined, true)
  }

  // Attach, then resync, until both succeed: every failed pass (an attach refused, or a fresh read refused on an attach
  // that is fine) waits 1 s doubling to 30 s, and the gap is reported lost once. `waitFirst`: the attach was just held.
  async #reattach(lost: string | undefined, restarted = false, waitFirst = false): Promise<void> {
    this.#release()
    if (lost !== undefined) this.#reportLost(lost)
    let wait = RETRY_FIRST_MS
    const backOff = async (): Promise<void> => {
      await this.link.delay(wait)
      wait = Math.min(wait * 2, RETRY_MAX_MS)
    }
    if (waitFirst) await backOff()
    while (!this.#done) {
      try {
        await this.#attach()
      } catch (error) {
        const code = codeOf(error)
        if (code !== undefined && ACCESS_REFUSED.has(code)) return this.#finish(`access:${code}`)
        if (code !== undefined && SESSION_GONE.has(code)) return this.#finish(this.#leftReason ?? "session_closed")
        this.#reportLost(code ?? "attach_failed")
        await backOff()
        continue
      }
      const outcome = await this.#resyncOnce(restarted)
      if (outcome === "done") return
      this.#release()
      this.#reportLost(outcome.reason)
      await backOff()
    }
  }

  async #readState(): Promise<StateRead> {
    const outcome = await this.link.getState(this.device, this.#key)
    if (outcome.kind !== "ok") return { kind: "failed", reason: outcome.reason }
    const data = outcome.response["data"]
    return { kind: "ok", state: sessionStateOf(this.#key, isJsonObject(data) ? data : {}) }
  }

  #adopt(state: RemoteSessionState): void {
    this.#status = state.status
    this.#durable = state.durableSessionId ?? this.#durable
    this.#runningTurn = state.status === "running" ? state.currentTurnId : undefined
  }

  #markSettled(turn: string): void {
    this.#settled.push(turn)
    if (this.#settled.length > SETTLED_KEPT) this.#settled.shift()
  }

  #reportLost(reason: string): void {
    if (this.#lostReported) return
    this.#lostReported = true
    this.#deliver(() => this.handlers.lost?.(reason))
  }

  // A handler that throws ends this watch only, with listener_failed; the attach and its other holders are untouched.
  #deliver(call: () => void): boolean {
    try {
      call()
      return true
    } catch {
      this.#finish("listener_failed")
      return false
    }
  }

  #release(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#held?.release()
    this.#held = undefined
  }

  #finish(end: RemoteWatchEnd): void {
    if (this.#done) return
    this.#done = true
    this.#queue.close()
    this.#release()
    this.#resolveEnded(end)
  }
}

export async function openSessionWatch(link: WatchLink, device: string, sessionId: string, handlers: RemoteWatchHandlers, options: { readonly baseline?: boolean } = {}): Promise<RemoteWatchOutcome> {
  return await new SessionWatch(link, device, sessionId, handlers).start(options.baseline === true)
}
