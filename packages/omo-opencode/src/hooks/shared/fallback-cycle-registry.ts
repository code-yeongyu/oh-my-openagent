export type FallbackCycleProbe = (sessionID: string) => boolean

let activeProbe: FallbackCycleProbe | undefined

/**
 * Cross-hook signal for "a runtime-fallback retry cycle is in progress".
 *
 * The runtime-fallback hook registers a probe over its per-session retry
 * state (`sessionRetryInFlight` / `sessionAwaitingFallbackResult`) so other
 * hooks - notably todo-continuation-enforcer - can suppress idle-driven
 * injections while a fallback/retry cycle is still resolving (#2063).
 */
export const FallbackCycleRegistry = {
  register: (probe: FallbackCycleProbe): void => {
    activeProbe = probe
  },

  unregister: (probe: FallbackCycleProbe): void => {
    if (activeProbe === probe) {
      activeProbe = undefined
    }
  },

  isActive: (sessionID: string): boolean => {
    return activeProbe?.(sessionID) ?? false
  },
}
