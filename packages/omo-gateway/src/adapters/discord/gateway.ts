import { AdapterFatal } from "../../adapter/contract"
import type { DiscordClock } from "./clock"
import { isJson } from "./wire"

// Gateway opcodes, intents and close codes: https://discord.com/developers/docs/topics/opcodes-and-status-codes
const OP = { dispatch: 0, heartbeat: 1, identify: 2, resume: 6, reconnect: 7, invalid_session: 9, hello: 10, heartbeat_ack: 11 } as const
export const DISCORD_INTENTS = (1 << 0) | (1 << 9) | (1 << 10) | (1 << 12) | (1 << 13) | (1 << 15)
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014])
const REIDENTIFY_CLOSE = new Set([4007, 4009])
const KEEP_SESSION_CLOSE = 4000

export type SocketHandlers = { onMessage(data: string): void; onClose(code: number): void; onError(message: string): void }
export type GatewaySocket = { send(data: string): void; close(code: number): void }
export type SocketFactory = (url: string, handlers: SocketHandlers) => GatewaySocket

export const webSocketFactory: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url)
  ws.addEventListener("message", (event) => handlers.onMessage(typeof event.data === "string" ? event.data : String(event.data)))
  ws.addEventListener("close", (event) => handlers.onClose(event.code))
  ws.addEventListener("error", () => handlers.onError("websocket error"))
  return { send: (data) => ws.send(data), close: (code) => ws.close(code) }
}

export class DiscordGatewayError extends AdapterFatal {
  readonly code: number
  constructor(code: number) {
    super("discord", `close ${code}`, `discord gateway closed with fatal code ${code}; not reconnecting`)
    this.name = "DiscordGatewayError"
    this.code = code
  }
}

export type GatewayOptions = {
  token: string
  url: string
  clock: DiscordClock
  socket: SocketFactory
  log: (line: string) => void
  backoff: { minMs: number; maxMs: number }
}

export type GatewayHandlers = {
  dispatch(type: string, data: unknown): void
  connected(how: "identified" | "resumed"): void
}

type Outcome = { code: number; invalid: boolean | null; connected: boolean }

/**
 * One Discord gateway session across reconnects: identify once, resume
 * after a drop (op 7, close 4000, a missed heartbeat ACK), re-identify when the session is gone
 * (op 9 with d=false, close 4007/4009), stop on fatal close codes. Resolves on abort.
 */
export class DiscordGateway {
  private session: string | null = null
  private seq: number | null = null
  private resumeUrl: string

  constructor(
    private readonly options: GatewayOptions,
    private readonly handlers: GatewayHandlers,
  ) {
    this.resumeUrl = options.url
  }

  async run(signal: AbortSignal): Promise<void> {
    let failures = 0
    while (!signal.aborted) {
      const outcome = await this.connect(signal)
      if (signal.aborted) return
      if (FATAL_CLOSE.has(outcome.code)) throw new DiscordGatewayError(outcome.code)
      if (outcome.invalid === false || REIDENTIFY_CLOSE.has(outcome.code)) {
        this.session = null
        this.seq = null
      }
      failures = outcome.connected ? 0 : failures + 1
      const { minMs, maxMs } = this.options.backoff
      const delay = outcome.invalid !== null ? 1000 + this.options.clock.random() * 4000 : failures === 0 ? 0 : Math.min(maxMs, minMs * 2 ** (failures - 1))
      this.options.log(`discord gateway closed ${outcome.code}; ${this.session === null ? "identifying" : "resuming"} in ${Math.round(delay)} ms`)
      await this.pause(delay, signal)
    }
  }

  private pause(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0 || signal.aborted) return Promise.resolve()
    return Promise.race([this.options.clock.sleep(ms), new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))])
  }

  private connect(signal: AbortSignal): Promise<Outcome> {
    const resume = this.session !== null
    const { clock, log } = this.options
    return new Promise((resolve) => {
      let cancelBeat: () => void = () => {}
      let acked = true
      let invalid: boolean | null = null
      let connected = false
      const send = (payload: object) => socket.send(JSON.stringify(payload))
      const beat = (interval: number) => {
        if (!acked) {
          log("discord gateway: no heartbeat ACK; reconnecting to resume")
          socket.close(KEEP_SESSION_CLOSE)
          return
        }
        acked = false
        send({ op: OP.heartbeat, d: this.seq })
        cancelBeat = clock.setTimer(() => beat(interval), interval)
      }
      const onAbort = () => socket.close(1000)
      const socket = this.options.socket(`${resume ? this.resumeUrl : this.options.url}/?v=10&encoding=json`, {
        onMessage: (data) => {
          let frame: unknown
          try {
            frame = JSON.parse(data)
          } catch {
            log("discord gateway: dropped a non-JSON frame")
            return
          }
          if (!isJson(frame) || typeof frame.op !== "number") return log("discord gateway: dropped a frame without an op")
          if (typeof frame.s === "number") this.seq = frame.s
          switch (frame.op) {
            case OP.hello: {
              const interval = isJson(frame.d) && typeof frame.d.heartbeat_interval === "number" ? frame.d.heartbeat_interval : 41_250
              cancelBeat = clock.setTimer(() => beat(interval), interval * clock.random())
              send(resume ? this.resumePayload() : this.identifyPayload())
              return
            }
            case OP.heartbeat_ack:
              acked = true
              return
            case OP.heartbeat:
              send({ op: OP.heartbeat, d: this.seq })
              return
            case OP.reconnect:
              socket.close(KEEP_SESSION_CLOSE)
              return
            case OP.invalid_session:
              invalid = frame.d === true
              socket.close(KEEP_SESSION_CLOSE)
              return
            case OP.dispatch:
              if (typeof frame.t !== "string") return
              if (frame.t === "READY" && isJson(frame.d) && typeof frame.d.session_id === "string") {
                this.session = frame.d.session_id
                if (typeof frame.d.resume_gateway_url === "string") this.resumeUrl = frame.d.resume_gateway_url
                connected = true
                this.handlers.connected("identified")
              } else if (frame.t === "RESUMED") {
                connected = true
                this.handlers.connected("resumed")
              }
              this.handlers.dispatch(frame.t, frame.d)
          }
        },
        onClose: (code) => {
          cancelBeat()
          signal.removeEventListener("abort", onAbort)
          resolve({ code, invalid, connected })
        },
        onError: (message) => log(`discord gateway: ${message}`),
      })
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  private identifyPayload() {
    return {
      op: OP.identify,
      d: {
        token: this.options.token,
        intents: DISCORD_INTENTS,
        properties: { os: process.platform, browser: "omo-gateway", device: "omo-gateway" },
        presence: { status: "online", since: null, activities: [], afk: false },
      },
    }
  }

  private resumePayload() {
    return { op: OP.resume, d: { token: this.options.token, session_id: this.session, seq: this.seq } }
  }
}
