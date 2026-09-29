// One live call, held by one isolated browser.
//
// The state machine is deliberately small and every wait is bounded and event-driven: the driver
// never sleeps and never polls. What counts as "we are really in the call" is the media plane
// reaching a connected peer connection - not a button that looked clickable, because the markup
// belongs to the chat client and can change under us at any time.

import { base64ToPcm16, chunkPcm16, pcm16ToBase64, resamplePcm16 } from "./audio"
import { type ChromeSession, type LaunchOptions, launchChrome } from "./browser"
import type { ChimeSignal } from "./chime"
import { recordOf } from "./json"
import { HuddlePage, type PageEvent } from "./huddle-page"
import { HuddleRoster, type RosterEvent } from "./huddle-roster"
import { type SlackSession, SlackWebApi } from "./slack-api"
import type { AudioFrame, CallEndReason, CallEvent, CallKey, SampleRate, Speaker } from "./voice-contract"
import { VoiceFatal, VoiceRefusal } from "./voice-contract"

export type { SlackSession } from "./slack-api"

export type HuddleDriverOptions = {
  /** the workspace id; the gateway's `account_id` for this surface */
  readonly account_id: string
  readonly session: SlackSession
  readonly profilesRoot: string
  readonly clientBaseUrl?: string
  readonly apiBaseUrl?: string
  readonly launch?: (options: LaunchOptions) => ChromeSession
  readonly fetchImpl?: typeof fetch
  readonly joinTimeoutMs?: number
  /** how long to wait for the client to render its huddle control; raise it on a loaded host */
  readonly controlReadyMs?: number
  /**
   * What to do when someone other than this account joins. The default stops the tap: a bridge must
   * not capture a person who has not been told it is there. The pipeline relaxes this once the call
   * has announced itself.
   */
  readonly onHumanJoin?: "stop_capture" | "continue"
}

export type HuddleState = "idle" | "launching" | "joining" | "in_call" | "leaving" | "closed"

export type HuddleStatus = {
  readonly state: HuddleState
  readonly chat_id: string | null
  readonly call_id: string | null
  readonly since: number | null
  readonly capturing: boolean
  readonly participants: readonly Speaker[]
  readonly thread_id: string | null
}

const DEFAULT_CLIENT = "https://app.slack.com/client"
const DEFAULT_API = "https://slack.com/api"
const JOIN_TIMEOUT_MS = 90_000
const INBOUND_TRACK_MS = 15_000
const SPEAK_CHUNK_SAMPLES = 24_000
const SPEAK_HIGH_WATER_MS = 1_500
const SPEAK_LOW_WATER_MS = 600

/**
 * What the local surface needs from a call. The driver implements it; a test can stand in for it
 * without a browser, and the server never depends on how a call is actually held.
 */
export type HuddleControl = {
  status(): HuddleStatus
  onAudio(sink: (frame: AudioFrame) => void): () => void
  onEvent(sink: (event: CallEvent) => void): () => void
  join(chat_id: string, signal?: AbortSignal): Promise<CallKey>
  leave(): Promise<void>
  speak(pcm16: Int16Array, sample_rate: SampleRate, signal?: AbortSignal): Promise<void>
  setCapture(on: boolean): Promise<void>
  stats(): Promise<Record<string, unknown> | null>
}

export class HuddleDriver implements HuddleControl {
  private readonly options: HuddleDriverOptions
  private readonly api: SlackWebApi
  private readonly roster = new HuddleRoster()
  private readonly audioSinks = new Set<(frame: AudioFrame) => void>()
  private readonly eventSinks = new Set<(event: CallEvent) => void>()
  private chrome: ChromeSession | null = null
  private page: HuddlePage | null = null
  private state: HuddleState = "idle"
  private chatId: string | null = null
  private callId: string | null = null
  private threadId: string | null = null
  private since: number | null = null
  private capturing = false
  private selfUserId: string | null = null

  constructor(options: HuddleDriverOptions) {
    this.options = options
    this.api = new SlackWebApi({ session: options.session, baseUrl: options.apiBaseUrl ?? DEFAULT_API, fetchImpl: options.fetchImpl })
  }

  status(): HuddleStatus {
    return { state: this.state, chat_id: this.chatId, call_id: this.callId, since: this.since, capturing: this.capturing, participants: this.roster.speakers(), thread_id: this.threadId }
  }

  onAudio(sink: (frame: AudioFrame) => void): () => void {
    this.audioSinks.add(sink)
    return () => void this.audioSinks.delete(sink)
  }

  onEvent(sink: (event: CallEvent) => void): () => void {
    this.eventSinks.add(sink)
    return () => void this.eventSinks.delete(sink)
  }

  /** Join the call in `chat_id`. One call per driver: a second join is refused, never queued. */
  async join(chat_id: string, signal?: AbortSignal): Promise<CallKey> {
    if (this.state === "in_call" || this.state === "joining" || this.state === "launching") {
      throw new VoiceRefusal("busy", `this account is already on a call in ${this.chatId ?? "another chat"}; one call per account`)
    }
    if (this.state === "closed") throw new VoiceRefusal("state", "this driver has been closed")
    this.state = "launching"
    this.chatId = chat_id
    try {
      const identity = await this.api.identify(this.options.account_id)
      this.selfUserId = identity.user_id
      const chrome = (this.options.launch ?? launchChrome)({ profilesRoot: this.options.profilesRoot })
      this.chrome = chrome
      void chrome.exited.then((code) => this.onBrowserGone(code))
      const page = new HuddlePage({
        connection: chrome.connection,
        session: this.options.session,
        clientBaseUrl: this.options.clientBaseUrl ?? DEFAULT_CLIENT,
        ...(this.options.controlReadyMs === undefined ? {} : { controlReadyMs: this.options.controlReadyMs }),
        onSignal: (signalFrame) => this.onSignal(signalFrame),
        onPageEvent: (event) => this.onPageEvent(event),
      })
      this.page = page
      await page.prepare()
      await page.openClient(identity.team_id, chat_id)
      this.state = "joining"
      // armed before the click: the media state, not the button, decides that the call is up
      const connected = page.waitFor("peer_state", (event) => event.state === "connected", this.options.joinTimeoutMs ?? JOIN_TIMEOUT_MS, signal)
      // pressing the control can fail before this is awaited; without a handler its later rejection
      // would surface as an unhandled rejection long after the join already reported the real fault
      connected.catch(() => undefined)
      await page.start()
      try {
        await connected
      } catch (error) {
        // the bridge's own view says whether the client ever built a connection, which separates
        // "the call never started" from "we could not see it"
        const snapshot = await page.bridge("snapshot()").catch(() => null)
        throw new VoiceFatal(`${error instanceof Error ? error.message : "the call never connected"} (bridge: ${JSON.stringify(snapshot)})`)
      }
      await page
        .waitFor("tap_ready", () => true, INBOUND_TRACK_MS, signal)
        .catch(() => this.emit({ kind: "error", call: this.callKey(), message: "the call is connected but no inbound audio track has arrived yet", fatal: false }))
      this.state = "in_call"
      this.since = Date.now()
      this.threadId = await this.api.findHuddleThread(chat_id).catch(() => null)
      this.callId = this.threadId ?? `call-${this.since}`
      await this.setCapture(true)
      this.emit({ kind: "joined", call: this.callKey(), by: this.self(), roster: this.roster.speakers() })
      return this.callKey()
    } catch (error) {
      await this.teardown("error")
      throw error
    }
  }

  async leave(): Promise<void> {
    if (this.state !== "in_call") return
    this.state = "leaving"
    await this.page?.leave().catch(() => false)
    await this.teardown("command")
  }

  /** Play `pcm16` into the call. Resolves once the audio has actually been played out. */
  async speak(pcm16: Int16Array, sample_rate: SampleRate, signal?: AbortSignal): Promise<void> {
    if (this.state !== "in_call") throw new VoiceRefusal("state", "there is no live call to speak into")
    const page = this.requirePage()
    const installed = recordOf(await page.bridge("install()"))
    if (installed.ok !== true) throw new VoiceFatal(`the call would not take injected audio: ${String(installed.reason ?? "unknown reason")}`)
    await page.bridge(`setLowWater(${SPEAK_LOW_WATER_MS})`)
    let lastId = 0
    for (const chunk of chunkPcm16(resamplePcm16(pcm16, sample_rate, 48_000), SPEAK_CHUNK_SAMPLES)) {
      if (signal?.aborted === true) throw new Error("speaking was aborted")
      const ack = recordOf(await page.bridge(`push(${JSON.stringify(pcm16ToBase64(chunk))})`))
      if (typeof ack.id === "number") lastId = ack.id
      // the page says when it has room again, so a producer faster than real time waits on an event
      if (typeof ack.queued_ms === "number" && ack.queued_ms > SPEAK_HIGH_WATER_MS) await page.waitFor("low_water", () => true, 60_000, signal)
    }
    if (lastId > 0) await page.waitFor("drained", (event) => typeof event.id === "number" && event.id >= lastId, 120_000, signal)
  }

  /** Stop or resume the inbound tap. Stopping is immediate: the page stops producing blocks at all. */
  async setCapture(on: boolean): Promise<void> {
    await this.page?.bridge(on ? "startTap()" : "stopTap()").catch(() => undefined)
    this.capturing = on
  }

  /** Live media counters: the evidence that audio is really moving. */
  async stats(): Promise<Record<string, unknown> | null> {
    const result = await this.page?.bridge("stats()").catch(() => null)
    return result === null || result === undefined ? null : recordOf(result)
  }

  async close(): Promise<void> {
    if (this.state === "closed") return
    await this.teardown("command")
    this.state = "closed"
  }

  private callKey(): CallKey {
    return { platform: "slack", account_id: this.options.account_id, chat_id: this.chatId ?? "", call_id: this.callId ?? "" }
  }

  private self(): Speaker {
    return { platform_user_id: this.selfUserId, display: "self", attribution: this.selfUserId === null ? "unattributed" : "exact" }
  }

  private requirePage(): HuddlePage {
    if (this.page === null) throw new VoiceFatal("the browser holding this call is gone")
    return this.page
  }

  private emit(event: CallEvent): void {
    for (const sink of this.eventSinks) sink(event)
  }

  private onSignal(signal: ChimeSignal): void {
    const events = signal.kind === "stream_ids" ? this.roster.applyStreams(signal.streams) : signal.kind === "audio_metadata" ? this.roster.applyVolumes(signal.attendees) : []
    for (const event of events) this.onRosterEvent(event)
  }

  private onRosterEvent(event: RosterEvent): void {
    const call = this.callKey()
    if (event.kind === "speaking") {
      this.emit({ kind: "speaking", call, who: event.who, state: event.state })
      return
    }
    const roster = this.roster.speakers()
    this.emit(event.kind === "joined" ? { kind: "joined", call, by: event.who, roster } : { kind: "left", call, who: event.who, roster })
    if (event.kind !== "joined") return
    if (this.options.onHumanJoin === "continue" || !this.capturing) return
    if (event.who.platform_user_id === this.selfUserId) return
    void this.setCapture(false)
    this.emit({ kind: "error", call, message: "another participant joined; the audio tap stopped because this call has not announced itself", fatal: false })
  }

  private onPageEvent(event: PageEvent): void {
    if (event.type === "call_window_closed" && this.state === "in_call") {
      void this.teardown("platform")
      return
    }
    if (event.type === "crashed") {
      this.emit({ kind: "error", call: this.callKey(), message: "the page holding the call crashed", fatal: true })
      return
    }
    if (event.type === "overflow") {
      this.emit({ kind: "error", call: this.callKey(), message: "outbound audio overflowed and the oldest block was dropped", fatal: false })
      return
    }
    if (event.type !== "audio" || this.audioSinks.size === 0 || typeof event.pcm !== "string") return
    const frame: AudioFrame = {
      call: this.callKey(),
      speaker: this.roster.current(),
      pcm16: base64ToPcm16(event.pcm),
      sample_rate: 48_000,
      at_ms: typeof event.at === "number" ? event.at : Date.now(),
    }
    for (const sink of this.audioSinks) sink(frame)
  }

  private onBrowserGone(code: number | null): void {
    if (this.state === "closed" || this.state === "leaving" || this.state === "idle") return
    const wasInCall = this.state === "in_call"
    this.state = "idle"
    this.capturing = false
    this.emit({ kind: "error", call: this.callKey(), message: `the browser holding the call exited (code ${code ?? "unknown"})`, fatal: true })
    if (wasInCall) this.emit({ kind: "ended", call: this.callKey(), reason: "error" })
  }

  private async teardown(reason: CallEndReason): Promise<void> {
    const wasLive = this.state === "in_call" || this.state === "leaving"
    const chrome = this.chrome
    this.chrome = null
    this.page = null
    this.capturing = false
    if (chrome !== null) await chrome.close().catch(() => undefined)
    if (wasLive) this.emit({ kind: "ended", call: this.callKey(), reason })
    if (this.state !== "closed") this.state = "idle"
    this.since = null
  }
}
