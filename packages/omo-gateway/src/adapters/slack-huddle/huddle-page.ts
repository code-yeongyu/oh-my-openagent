// Driving the chat client's page over the debugging protocol.
//
// Everything that knows about the client's windows and buttons lives here, so the state machine in
// driver.ts stays about the call rather than about markup. The markup is NOT ours and will change:
// selectors are tried first, visible button text second, and neither is ever the authority for
// whether the call is up - the media state is (see driver.ts).

import type { CdpConnection } from "./cdp"
import { recordOf } from "./json"
import { type ChimeSignal, decodeSignalFrame } from "./chime"
import { BRIDGE_BINDING, BRIDGE_NAMESPACE, PAGE_BRIDGE_SOURCE } from "./page-bridge"
import { CONFIRM_TEXT, type ClickResult, LEAVE_SELECTORS, LEAVE_TEXT, START_SELECTORS, WAIT_AND_CLICK_SOURCE } from "./page-controls"
import { cookieValue, type SlackSession } from "./slack-api"
import { VoiceFatal } from "./voice-contract"

export type PageEvent = Record<string, unknown>

const CHILD_WINDOW_MS = 20_000
// The client's own boot: its markup appears well after the page reports itself loaded, and on a
// loaded host that boot is slow rather than broken - so this is a budget the caller can raise.
const CONTROL_READY_MS = 60_000
const CONFIRM_READY_MS = 20_000
const LOAD_MS = 60_000

export class HuddlePage {
  private readonly connection: CdpConnection
  private readonly session: SlackSession
  private readonly clientBaseUrl: string
  private readonly controlReadyMs: number
  private readonly onSignal: (signal: ChimeSignal) => void
  private readonly onPageEvent: (event: PageEvent) => void
  private readonly sockets = new Map<string, string>()
  private readonly pages: string[] = []
  private readonly ready = new Map<string, Promise<void>>()
  private readonly pageWaiters = new Set<() => void>()
  private readonly waiters = new Map<string, Set<(event: PageEvent) => void>>()
  private main: string | null = null
  private userAgent: string | null = null
  private callWindow: string | null = null

  constructor(input: {
    readonly connection: CdpConnection
    readonly session: SlackSession
    readonly clientBaseUrl: string
    readonly controlReadyMs?: number
    readonly onSignal: (signal: ChimeSignal) => void
    readonly onPageEvent: (event: PageEvent) => void
  }) {
    this.connection = input.connection
    this.session = input.session
    this.clientBaseUrl = input.clientBaseUrl
    this.controlReadyMs = input.controlReadyMs ?? CONTROL_READY_MS
    this.onSignal = input.onSignal
    this.onPageEvent = input.onPageEvent
  }

  /** Subscribe to the browser and attach to every page it opens, including the call window. */
  async prepare(): Promise<void> {
    this.connection.on("Target.attachedToTarget", (params, sessionId) => {
      if (recordOf(params.targetInfo).type !== "page") return
      const child = typeof params.sessionId === "string" ? params.sessionId : sessionId
      if (child !== undefined) this.notePage(child)
    })
    this.connection.on("Target.detachedFromTarget", (params) => {
      if (params.sessionId !== this.callWindow) return
      this.callWindow = null
      this.deliver({ type: "call_window_closed" })
    })
    this.connection.on("Runtime.bindingCalled", (params) => {
      if (params.name !== BRIDGE_BINDING || typeof params.payload !== "string") return
      const parsed: unknown = JSON.parse(params.payload)
      this.deliver(recordOf(parsed))
    })
    this.connection.on("Inspector.targetCrashed", () => this.deliver({ type: "crashed" }))
    this.connection.on("Network.webSocketCreated", (params, sessionId) => {
      if (typeof params.requestId === "string" && typeof params.url === "string") this.sockets.set(`${sessionId ?? ""}:${params.requestId}`, params.url)
    })
    this.connection.on("Network.webSocketFrameReceived", (params, sessionId) => {
      const url = this.sockets.get(`${sessionId ?? ""}:${String(params.requestId)}`)
      if (url === undefined || !url.includes(".chime.aws")) return
      const payload = recordOf(params.response).payloadData
      if (typeof payload !== "string") return
      const decoded = decodeSignalFrame(base64Bytes(payload))
      if (decoded !== null) this.onSignal(decoded)
    })
    // A headless build announces itself in its user agent, and the chat client gates calling on
    // browser support - so the call window opens and then renders nothing at all. Taking the marker
    // out of the browser's OWN string keeps this correct across browser versions.
    const version = recordOf(await this.connection.send("Browser.getVersion").catch(() => ({})))
    const announced = version.userAgent
    if (typeof announced === "string" && announced !== "") this.userAgent = announced.replace(/Headless/g, "")
    await this.connection.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
  }

  /**
   * Hand the browser this account's session and open the chat.
   *
   * The page is instrumented BEFORE it navigates: the bridge wraps the connection the client builds,
   * so a page that reached the client first would never be seen at all.
   */
  async openClient(team_id: string, chat_id: string): Promise<void> {
    const known = this.pages.length
    await this.connection.send("Target.createTarget", { url: "about:blank" })
    const sessionId = await this.nextPage(known, 30_000)
    await this.ready.get(sessionId)
    this.main = sessionId
    await this.connection.send(
      "Network.setCookie",
      { name: "d", value: cookieValue(this.session.cookie), domain: ".slack.com", path: "/", secure: true, httpOnly: true, sameSite: "None" },
      { sessionId },
    )
    // armed before the navigation, because a fast load fires before a listener registered after it
    const loaded = this.connection.once("Page.loadEventFired", (_params, session) => session === sessionId, LOAD_MS)
    loaded.catch(() => undefined)
    await this.connection.send("Page.navigate", { url: `${this.clientBaseUrl}/${team_id}/${chat_id}` }, { sessionId })
    await loaded.catch(() => undefined)
  }

  /**
   * Press the client's huddle control.
   *
   * The chat window only opens the call window; the confirm button lives in that second window, so
   * whichever page shows it is pressed too.
   */
  async start(): Promise<void> {
    const sessionId = this.requireMain()
    const known = this.pages.length
    const opened = await this.click(sessionId, START_SELECTORS, CONFIRM_TEXT, this.controlReadyMs)
    if (!opened.clicked) {
      throw new VoiceFatal(`the client showed no huddle control in this chat within ${CONTROL_READY_MS} ms (page "${opened.title ?? ""}", ${opened.buttons ?? 0} controls: ${opened.candidates.slice(0, 8).join(", ")})`)
    }
    const child = await this.nextPage(known, CHILD_WINDOW_MS).catch(() => null)
    if (child !== null) {
      await this.ready.get(child)
      const confirmed = await this.click(child, [], CONFIRM_TEXT, CONFIRM_READY_MS)
      if (confirmed.clicked) {
        this.callWindow = child
        return
      }
    }
    // some layouts confirm in the chat window itself rather than a separate call window
    await this.click(sessionId, [], CONFIRM_TEXT, CONFIRM_READY_MS).catch(() => null)
  }

  /** Press leave in whichever window owns the call. */
  async leave(): Promise<boolean> {
    for (const sessionId of [this.callWindow, ...this.pages]) {
      if (sessionId === null) continue
      const result = await this.click(sessionId, LEAVE_SELECTORS, LEAVE_TEXT, CONFIRM_READY_MS).catch(() => null)
      if (result !== null && result.clicked) return true
    }
    return false
  }

  /** Call into the injected bridge, e.g. `push("...")` or `stats()`. */
  async bridge(call: string): Promise<unknown> {
    const sessionId = this.requireMain()
    const result = await this.connection.send(
      "Runtime.evaluate",
      { expression: `window[${JSON.stringify(BRIDGE_NAMESPACE)}].${call}`, returnByValue: true, awaitPromise: true },
      { sessionId },
    )
    if (recordOf(result.exceptionDetails).text !== undefined) throw new VoiceFatal(`the page bridge failed on ${call.split("(")[0] ?? call}`)
    return recordOf(result.result).value
  }

  /** A picture of every window, for diagnosing a join that never reached a live call. */
  async screenshots(): Promise<readonly string[]> {
    const out: string[] = []
    for (const sessionId of this.pages) {
      const shot = await this.connection.send("Page.captureScreenshot", { format: "png" }, { sessionId, timeoutMs: 20_000 }).catch(() => null)
      const data = shot === null ? null : shot.data
      if (typeof data === "string") out.push(data)
    }
    return out
  }

  /** Wait for one page event. Arm this BEFORE the action that triggers it; never poll for it. */
  waitFor(type: string, match: (event: PageEvent) => boolean, timeoutMs: number, signal?: AbortSignal): Promise<PageEvent> {
    return new Promise((resolve, reject) => {
      const set = this.waiters.get(type) ?? new Set<(event: PageEvent) => void>()
      this.waiters.set(type, set)
      const stop = (): void => {
        set.delete(listener)
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
      }
      const listener = (event: PageEvent): void => {
        if (!match(event)) return
        stop()
        resolve(event)
      }
      const onAbort = (): void => {
        stop()
        reject(new Error(`waiting for ${type} was aborted`))
      }
      const timer = setTimeout(() => {
        stop()
        reject(new Error(`the client never reported ${type} within ${timeoutMs} ms`))
      }, timeoutMs)
      set.add(listener)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  private notePage(sessionId: string): void {
    if (this.ready.has(sessionId)) return
    this.ready.set(sessionId, this.setupPage(sessionId))
    this.pages.push(sessionId)
    for (const waiter of [...this.pageWaiters]) waiter()
  }

  /** The page at `index`, whether it attached before this call or arrives while it waits. */
  private nextPage(index: number, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const stop = (): void => {
        this.pageWaiters.delete(waiter)
        clearTimeout(timer)
      }
      const waiter = (): void => {
        const found = this.pages[index]
        if (found === undefined) return
        stop()
        resolve(found)
      }
      const timer = setTimeout(() => {
        stop()
        reject(new VoiceFatal(`the browser opened no window for the call within ${timeoutMs} ms`))
      }, timeoutMs)
      this.pageWaiters.add(waiter)
      waiter()
    })
  }

  private requireMain(): string {
    if (this.main === null) throw new VoiceFatal("the client page is not attached")
    return this.main
  }

  private deliver(event: PageEvent): void {
    const type = typeof event.type === "string" ? event.type : ""
    for (const listener of [...(this.waiters.get(type) ?? [])]) listener(event)
    this.onPageEvent(event)
  }

  private async setupPage(sessionId: string): Promise<void> {
    const options = { sessionId }
    // a page we cannot instrument is still a page the client may use; it must not fail the join
    const quiet = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => this.connection.send(method, params, options).catch(() => undefined)
    // ORDER IS LOAD-BEARING. A target attaches PAUSED, and the client opens its call window with
    // window.open: a window left paused renders nothing, so the call never starts. Only the two
    // calls that must precede any script run first; the page is released immediately after, and the
    // remaining domains are enabled on a page that is already running.
    await quiet("Runtime.addBinding", { name: BRIDGE_BINDING })
    await quiet("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_BRIDGE_SOURCE })
    if (this.userAgent !== null) await quiet("Network.setUserAgentOverride", { userAgent: this.userAgent })
    await quiet("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
    await quiet("Runtime.runIfWaitingForDebugger")
    await quiet("Page.enable")
    await quiet("Network.enable")
    await quiet("Runtime.enable")
  }

  /** Wait for a control to exist, then press it. The page owns the waiting; the host awaits one promise. */
  private async click(sessionId: string, selectors: readonly string[], texts: readonly string[], timeoutMs: number): Promise<ClickResult> {
    const result = await this.connection.send(
      "Runtime.evaluate",
      { expression: `(${WAIT_AND_CLICK_SOURCE})(${JSON.stringify(selectors)}, ${JSON.stringify(texts)}, ${timeoutMs})`, returnByValue: true, awaitPromise: true },
      { sessionId, timeoutMs: timeoutMs + 10_000 },
    )
    const value = recordOf(recordOf(result.result).value)
    const candidates = Array.isArray(value.candidates) ? value.candidates.filter((entry): entry is string => typeof entry === "string") : []
    return {
      clicked: value.clicked === true,
      candidates,
      ...(typeof value.how === "string" ? { how: value.how } : {}),
      ...(typeof value.title === "string" ? { title: value.title } : {}),
      ...(typeof value.buttons === "number" ? { buttons: value.buttons } : {}),
    }
  }
}

function base64Bytes(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
