import type { ProbeProvider, ProbeRequest } from "../providers/provider-types"
import type { MuteState } from "./rate-limit-types"

const USERS_CURRENT_PATH = "/api/v0/users/current"
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_BODY_PREVIEW = 800

export async function pollMuteState(
  provider: ProbeProvider,
  baseUrl: string,
  sessionLabel = "rate-mute-watcher",
): Promise<MuteState> {
  const url = `${baseUrl.replace(/\/$/, "")}${USERS_CURRENT_PATH}`
  const req: ProbeRequest = {
    url,
    method: "GET",
    headers: {},
    timeout_ms: DEFAULT_TIMEOUT_MS,
    forward_as_is: false,
    metadata: { session_id: sessionLabel, exchange_sequence: 0 },
  }
  const res = await provider.dispatchProbe(req)
  const parsed = parseMuteFromBody(res.body)
  return {
    is_muted: parsed.is_muted,
    mute_until: parsed.mute_until,
    sampled_at: Date.now(),
    raw_status: res.status,
    raw_body_preview:
      res.body.length <= MAX_BODY_PREVIEW ? res.body : `${res.body.slice(0, MAX_BODY_PREVIEW)}…[truncated]`,
  }
}

function makeUnreachableState(): MuteState {
  return {
    is_muted: 0,
    mute_until: null,
    sampled_at: Date.now(),
    raw_status: 0,
    raw_body_preview: "[poll_failed]",
  }
}

function parseMuteFromBody(body: string): { is_muted: 0 | 1; mute_until: number | null } {
  try {
    const parsed = JSON.parse(body) as {
      data?: { biz_data?: { chat?: { is_muted?: number; mute_until?: number | null } } }
    }
    const chat = parsed?.data?.biz_data?.chat
    const is_muted = chat?.is_muted === 1 ? 1 : 0
    const mute_until = typeof chat?.mute_until === "number" ? chat.mute_until : null
    return { is_muted, mute_until }
  } catch {
    return { is_muted: 0, mute_until: null }
  }
}

export type MuteWatcher = {
  start: () => void
  stop: () => Promise<void>
  getLast: () => MuteState | null
  hasMutedSinceStart: () => boolean
  getSamples: () => MuteState[]
}

export type MuteWatcherArgs = {
  provider: ProbeProvider
  baseUrl: string
  intervalMs: number
  onFlip?: (state: MuteState) => void
  sleep?: (ms: number) => Promise<void>
}

export function createMuteWatcher(args: MuteWatcherArgs): MuteWatcher {
  const sleep = args.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const samples: MuteState[] = []
  let last: MuteState | null = null
  let running = false
  let muteSeen = false
  let loopPromise: Promise<void> | null = null

  const tick = async () => {
    try {
      const state = await pollMuteState(args.provider, args.baseUrl)
      const wasMuted = last?.is_muted === 1
      last = state
      samples.push(state)
      if (state.is_muted === 1 && !wasMuted) {
        muteSeen = true
        if (args.onFlip) args.onFlip(state)
      }
    } catch {
      last = makeUnreachableState()
    }
  }

  const loop = async () => {
    while (running) {
      await tick()
      if (!running) break
      await sleep(args.intervalMs)
    }
  }

  return {
    start: () => {
      if (running) return
      running = true
      loopPromise = loop()
    },
    stop: async () => {
      running = false
      if (loopPromise) {
        await loopPromise
        loopPromise = null
      }
    },
    getLast: () => last,
    hasMutedSinceStart: () => muteSeen,
    getSamples: () => [...samples],
  }
}
