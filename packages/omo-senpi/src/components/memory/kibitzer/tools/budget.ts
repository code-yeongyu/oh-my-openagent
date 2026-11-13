// Per-wake tool-call budget. The sidecar lifecycle creates one budget per wake; every sidecar tool
// charges it on entry, so the count is authoritative regardless of which closure the model calls.

export interface WakeToolBudget {
  readonly limit: number
  readonly used: number
  /** Charges one call; false when the budget was already exhausted (the call is NOT counted). */
  charge(): boolean
}

export function createWakeToolBudget(limit: number): WakeToolBudget {
  let used = 0
  return {
    limit,
    get used() {
      return used
    },
    charge() {
      if (used >= limit) return false
      used += 1
      return true
    },
  }
}
