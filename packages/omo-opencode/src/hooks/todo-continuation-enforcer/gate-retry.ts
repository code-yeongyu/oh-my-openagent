import { log } from "../../shared/logger"

import { GATE_RETRY_DELAY_MS, HOOK_NAME, MAX_GATE_RETRIES } from "./constants"
import type { SessionState } from "./types"

const TRANSIENT_GATE_DECLINE_STATUSES = new Set(["active", "reserved"])

export function isTransientGateDecline(status: string): boolean {
  return TRANSIENT_GATE_DECLINE_STATUSES.has(status)
}

export function scheduleGateRetry(args: {
  readonly sessionID: string
  readonly state: SessionState
  readonly reason: string
  readonly inject: () => Promise<void>
}): void {
  const { sessionID, state, reason, inject } = args
  if (state.gateRetryTimer) {
    return
  }

  const attempt = (state.gateRetryCount ?? 0) + 1
  if (attempt > MAX_GATE_RETRIES) {
    log(`[${HOOK_NAME}] Gate retry budget exhausted`, { sessionID, reason })
    return
  }

  state.gateRetryCount = attempt
  state.gateRetryTimer = setTimeout(() => {
    state.gateRetryTimer = undefined
    log(`[${HOOK_NAME}] Gate retry firing`, { sessionID, reason, attempt })
    void inject()
  }, GATE_RETRY_DELAY_MS)
}
