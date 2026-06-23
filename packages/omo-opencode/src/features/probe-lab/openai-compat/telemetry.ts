import type { OpenAIErrorType } from "./errors"

export type TelemetryErrorClass =
  | "http_4xx"
  | "http_429"
  | "missing_header"
  | "empty_sse"
  | "truncated_stream"
  | "mute_observed"
  | "success"
  | "empty_output_after_retry"
  | "timeout"
  | "connection_reset"

export type TelemetryEvent = {
  account_id: string
  error_type: TelemetryErrorClass
  ts: number
  request_id: string
  status?: number
}

export type TelemetryAccountSnapshot = {
  account_id: string
  counters: Record<TelemetryErrorClass, number>
  recent: ReadonlyArray<TelemetryEvent>
}

export type TelemetrySnapshot = {
  total_events: number
  per_account: ReadonlyArray<TelemetryAccountSnapshot>
}

const RING_SIZE = 1000

const ZERO_COUNTERS: Record<TelemetryErrorClass, number> = {
  http_4xx: 0,
  http_429: 0,
  missing_header: 0,
  empty_sse: 0,
  truncated_stream: 0,
  mute_observed: 0,
  success: 0,
  empty_output_after_retry: 0,
  timeout: 0,
  connection_reset: 0,
}

type AccountState = {
  counters: Record<TelemetryErrorClass, number>
  ring: TelemetryEvent[]
  ringHead: number
  ringFilled: boolean
}

function newAccountState(): AccountState {
  return {
    counters: { ...ZERO_COUNTERS },
    ring: new Array<TelemetryEvent>(RING_SIZE),
    ringHead: 0,
    ringFilled: false,
  }
}

export type Telemetry = {
  record: (ev: TelemetryEvent) => void
  snapshot: () => TelemetrySnapshot
  reset: () => void
}

export function createTelemetry(): Telemetry {
  const accounts = new Map<string, AccountState>()

  function getOrCreate(id: string): AccountState {
    let s = accounts.get(id)
    if (!s) {
      s = newAccountState()
      accounts.set(id, s)
    }
    return s
  }

  return {
    record(ev) {
      const s = getOrCreate(ev.account_id)
      s.counters[ev.error_type]++
      s.ring[s.ringHead] = ev
      s.ringHead = (s.ringHead + 1) % RING_SIZE
      if (s.ringHead === 0) s.ringFilled = true
    },
    snapshot() {
      const per_account: TelemetryAccountSnapshot[] = []
      let total = 0
      for (const [account_id, s] of accounts.entries()) {
        const recentLen = s.ringFilled ? RING_SIZE : s.ringHead
        const recent: TelemetryEvent[] = new Array(recentLen)
        if (s.ringFilled) {
          for (let i = 0; i < RING_SIZE; i++) {
            recent[i] = s.ring[(s.ringHead + i) % RING_SIZE]!
          }
        } else {
          for (let i = 0; i < s.ringHead; i++) recent[i] = s.ring[i]!
        }
        for (const k of Object.keys(s.counters) as TelemetryErrorClass[]) {
          total += s.counters[k]
        }
        per_account.push({
          account_id,
          counters: { ...s.counters },
          recent,
        })
      }
      return { total_events: total, per_account }
    },
    reset() {
      accounts.clear()
    },
  }
}

export function classifyVerdict(args: {
  ok: boolean
  status?: number
  errorType?: OpenAIErrorType
  message?: string
}): TelemetryErrorClass {
  if (args.ok) return "success"
  if (args.errorType === "empty_sse") return "empty_sse"
  if (args.errorType === "truncated_stream") return "truncated_stream"
  const msg = typeof args.message === "string" ? args.message : ""
  if (msg.includes("MISSING_HEADER")) return "missing_header"
  if (isTimeoutMessage(msg)) return "timeout"
  if (isConnectionResetMessage(msg)) return "connection_reset"
  if (args.status === 429) return "http_429"
  if (typeof args.status === "number" && args.status >= 400 && args.status < 500) {
    return "http_4xx"
  }
  return "http_4xx"
}

function isTimeoutMessage(msg: string): boolean {
  if (msg.length === 0) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("etimedout")
  )
}

function isConnectionResetMessage(msg: string): boolean {
  if (msg.length === 0) return false
  return (
    msg.includes("ECONNRESET") ||
    /stream errored/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    /connection reset/i.test(msg) ||
    msg.includes("EPIPE")
  )
}

let GLOBAL: Telemetry | null = null

export function getGlobalTelemetry(): Telemetry {
  if (!GLOBAL) GLOBAL = createTelemetry()
  return GLOBAL
}

export function resetGlobalTelemetryForTests(): void {
  GLOBAL = null
}
