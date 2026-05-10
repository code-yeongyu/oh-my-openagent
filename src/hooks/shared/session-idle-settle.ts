export const DEFAULT_SESSION_IDLE_SETTLE_MS = 150

export function settleAfterSessionIdle(ms = DEFAULT_SESSION_IDLE_SETTLE_MS): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}
