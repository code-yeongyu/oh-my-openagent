import { randomUUID } from "crypto"
import type { ReplyListenerDaemonState } from "./reply-listener-state"

const DEFAULT_REPLY_LISTENER_STARTUP_TIMEOUT_MS = 500
const REPLY_LISTENER_READY_POLL_INTERVAL_MS = 10

interface WaitForReplyListenerReadyOptions {
  pid: number
  startupToken: string
  timeoutMs: number
  readState: () => ReplyListenerDaemonState | null
  sleep: (ms: number) => Promise<void>
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function createReplyListenerStartupToken(): string {
  return randomUUID()
}

export function getReplyListenerStartupTimeoutMs(): number {
  const raw = process.env.OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TIMEOUT_MS
  if (!raw) return DEFAULT_REPLY_LISTENER_STARTUP_TIMEOUT_MS

  const parsed = Number.parseInt(raw, 10)
  return isPositiveInteger(parsed) ? parsed : DEFAULT_REPLY_LISTENER_STARTUP_TIMEOUT_MS
}

function isReadyState(
  state: ReplyListenerDaemonState | null,
  pid: number,
  startupToken: string,
): state is ReplyListenerDaemonState {
  return Boolean(
    state
      && state.isRunning
      && state.pid === pid
      && state.startupToken === startupToken
      && state.lastPollAt !== null,
  )
}

export async function waitForReplyListenerReady(
  options: WaitForReplyListenerReadyOptions,
): Promise<ReplyListenerDaemonState | null> {
  const deadline = Date.now() + options.timeoutMs

  while (Date.now() <= deadline) {
    const state = options.readState()
    if (isReadyState(state, options.pid, options.startupToken)) {
      return state
    }

    await options.sleep(REPLY_LISTENER_READY_POLL_INTERVAL_MS)
  }

  return null
}
