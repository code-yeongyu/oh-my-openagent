// The adapter's ONE realtime line per account: RTM (`rtm.connect`) for a user session token, Socket
// Mode (`apps.connections.open`) for a Slack app. `listen` and typing share it: typing reuses the
// listening socket, or opens the line once (single-flight) and closes it after an idle period, so N
// sends never dial N times and no second socket per account is ever opened. Every wait is bounded:
// the dial, the hello after it, the RTM pong, and the reconnect backoff; a rejected credential trips
// the adapter's AuthLatch and stops reconnecting.
import { SlackAuthError, type AuthLatch } from "./api"
import type { SlackClock } from "./clock"
import type { RealtimeSocket, SocketFactory } from "./socket"
import { isJson, type Json } from "./wire"

export type RealtimeProfile = "rtm" | "socket_mode"
export type Dialed = { url: string; headers: Readonly<Record<string, string>> }

export type RealtimeTimings = {
  dialTimeoutMs: number
  helloTimeoutMs: number
  pingIntervalMs: number
  pongTimeoutMs: number
  idleCloseMs: number
  backoffMinMs: number
  backoffMaxMs: number
}

export const REALTIME_TIMINGS: RealtimeTimings = {
  dialTimeoutMs: 30_000,
  helloTimeoutMs: 30_000,
  pingIntervalMs: 30_000,
  pongTimeoutMs: 10_000,
  idleCloseMs: 60_000,
  backoffMinMs: 1_000,
  backoffMaxMs: 30_000,
}

export type RealtimeOptions = {
  profile: RealtimeProfile
  dial: () => Promise<Dialed>
  socket: SocketFactory
  clock: SlackClock
  latch: AuthLatch
  log: (line: string) => void
  timings: RealtimeTimings
}

export type RealtimeHandlers = { event(type: string, data: Json): void; connected(first: boolean): void }

type Conn = { socket: RealtimeSocket; closed: Promise<number>; open: boolean }

export class SlackRealtime {
  private current: Conn | null = null
  private opening: Promise<Conn> | null = null
  private listener: RealtimeHandlers | null = null
  private cancelIdle: () => void = () => undefined
  private frameId = 0

  constructor(private readonly options: RealtimeOptions) {}

  private within<T>(work: Promise<T>, ms: number): Promise<T | null> {
    const { promise, resolve } = Promise.withResolvers<T | null>()
    const cancel = this.options.clock.setTimer(() => resolve(null), ms)
    work.then(
      (value) => {
        cancel()
        resolve(value)
      },
      () => {
        cancel()
        resolve(null)
      },
    )
    return promise
  }

  /** The live line, or a new one (single-flight). Rejects on dial failure, a missing hello or a dead credential. */
  acquire(): Promise<Conn> {
    const dead = this.options.latch.error
    if (dead !== null) return Promise.reject(dead)
    if (this.current?.open === true) return Promise.resolve(this.current)
    if (this.opening !== null) return this.opening
    const opening = this.open()
    this.opening = opening
    const clear = () => {
      if (this.opening === opening) this.opening = null
    }
    opening.then(clear, clear)
    return opening
  }

  private async open(): Promise<Conn> {
    const { dial, timings, log } = this.options
    let failure: unknown = null
    const dialed = await this.within(
      dial().catch((error: unknown) => {
        failure = error
        throw error
      }),
      timings.dialTimeoutMs,
    )
    if (failure instanceof SlackAuthError) throw this.options.latch.trip(failure)
    if (dialed === null) throw failure instanceof Error ? failure : new Error(`slack ${this.options.profile} dial gave no url within ${timings.dialTimeoutMs} ms`)
    const conn = await this.connect(dialed)
    if (this.listener === null) this.touchIdle(conn)
    log(`slack ${this.options.profile} line open`)
    return conn
  }

  private connect(dialed: Dialed): Promise<Conn> {
    const { clock, timings, log } = this.options
    const closed = Promise.withResolvers<number>()
    const hello = Promise.withResolvers<Conn>()
    let cancelHello: () => void = () => undefined
    let cancelPong: () => void = () => undefined
    let cancelPing: () => void = () => undefined
    const ping = () => {
      cancelPing = clock.setTimer(() => {
        this.frameId += 1
        conn.socket.send(JSON.stringify({ id: this.frameId, type: "ping" }))
        cancelPong = clock.setTimer(() => {
          log(`slack rtm: no pong within ${timings.pongTimeoutMs} ms; reconnecting`)
          conn.socket.close(4000)
        }, timings.pongTimeoutMs)
        ping()
      }, timings.pingIntervalMs)
    }
    const greeted = () => {
      cancelHello()
      conn.open = true
      this.current = conn
      if (this.options.profile === "rtm") ping()
      hello.resolve(conn)
    }
    const socket = this.options.socket(dialed.url, dialed.headers, {
      onMessage: (data) => this.frame(conn, data, greeted, () => cancelPong()),
      onClose: (code) => {
        cancelHello()
        cancelPing()
        cancelPong()
        conn.open = false
        if (this.current === conn) this.current = null
        hello.reject(new Error(`slack ${this.options.profile} socket closed (${code}) before hello`))
        closed.resolve(code)
      },
      onError: (message) => log(`slack ${this.options.profile}: ${message}`),
    })
    const conn: Conn = { socket, closed: closed.promise, open: false }
    cancelHello = clock.setTimer(() => {
      log(`slack ${this.options.profile}: no hello within ${timings.helloTimeoutMs} ms; closing`)
      socket.close(4000)
    }, timings.helloTimeoutMs)
    return hello.promise
  }

  private frame(conn: Conn, data: string, greeted: () => void, ponged: () => void): void {
    let frame: unknown
    try {
      frame = JSON.parse(data)
    } catch {
      this.options.log(`slack ${this.options.profile}: dropped a non-JSON frame`)
      return
    }
    if (!isJson(frame)) return
    const type = typeof frame.type === "string" ? frame.type : null
    if (this.options.profile === "socket_mode") return this.socketModeFrame(conn, frame, type, greeted)
    if (frame.reply_to !== undefined || type === "pong") return ponged()
    if (type === "hello") return greeted()
    if (type === "goodbye" || type === "team_migration_started") return conn.socket.close(1000)
    if (type !== null && conn.open) this.listener?.event(type, frame)
  }

  private socketModeFrame(conn: Conn, frame: Json, type: string | null, greeted: () => void): void {
    if (typeof frame.envelope_id === "string") conn.socket.send(JSON.stringify({ envelope_id: frame.envelope_id }))
    if (type === "hello") return greeted()
    if (type === "disconnect") {
      if (frame.reason === "link_disabled") this.options.latch.trip(new SlackAuthError("apps.connections.open", "link_disabled"))
      return conn.socket.close(1000)
    }
    const event = type === "events_api" && isJson(frame.payload) && isJson(frame.payload.event) ? frame.payload.event : null
    if (event !== null && typeof event.type === "string" && conn.open) this.listener?.event(event.type, event)
  }

  private touchIdle(conn: Conn): void {
    this.cancelIdle()
    this.cancelIdle = this.options.clock.setTimer(() => {
      if (this.listener === null && this.current === conn) conn.socket.close(1000)
    }, this.options.timings.idleCloseMs)
  }

  /** Send one frame on the line, dialing it only when none is live. False when no line was ready within `budgetMs`. */
  async sendFrame(frame: Json, budgetMs: number): Promise<boolean> {
    if (this.options.latch.error !== null) return false
    const conn = await this.within(this.acquire(), budgetMs)
    if (conn === null || !conn.open) return false
    this.frameId += 1
    conn.socket.send(JSON.stringify({ id: this.frameId, ...frame }))
    if (this.listener === null) this.touchIdle(conn)
    return true
  }

  /** Keep the line up until `signal` aborts: reconnect after every close with bounded backoff; stop on a dead credential. */
  async run(signal: AbortSignal, handlers: RealtimeHandlers): Promise<void> {
    if (this.listener !== null) throw new Error("slack realtime: one listen per adapter")
    this.listener = handlers
    this.cancelIdle()
    let failures = 0
    let first = true
    const aborted = new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true }))
    try {
      while (!signal.aborted) {
        const conn = await Promise.race([this.acquire(), aborted]).catch((error: unknown) => error)
        if (conn === null) break
        const dead = this.options.latch.error
        if (dead !== null) throw dead
        if (!isConn(conn)) {
          failures += 1
          const delay = Math.min(this.options.timings.backoffMaxMs, this.options.timings.backoffMinMs * 2 ** (failures - 1))
          this.options.log(`slack ${this.options.profile} connect failed (${conn instanceof Error ? conn.message : String(conn)}); retrying in ${delay} ms`)
          await this.options.clock.sleep(delay, signal)
          continue
        }
        failures = 0
        handlers.connected(first)
        first = false
        const onAbort = () => conn.socket.close(1000)
        signal.addEventListener("abort", onAbort, { once: true })
        const code = await conn.closed
        signal.removeEventListener("abort", onAbort)
        const deadAfter = this.options.latch.error
        if (deadAfter !== null) throw deadAfter
        if (!signal.aborted) this.options.log(`slack ${this.options.profile} line closed (${code}); reconnecting`)
      }
    } finally {
      this.listener = null
      if (signal.aborted) this.current?.socket.close(1000)
    }
  }

  close(): void {
    this.cancelIdle()
    this.current?.socket.close(1000)
  }
}

function isConn(value: unknown): value is Conn {
  return isJson(value) && "socket" in value && "closed" in value
}
