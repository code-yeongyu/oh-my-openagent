import type { ProbeStore } from "./sqlite-store"

export type CanaryTestResult = "pass" | "fail"

export type CanaryHealth = {
  canary_count: number
  active_canary_count: number
  last_results: Array<{ identity_id: string; result: string | null; tested_at: number | null }>
}

export function createCanaryManager(args: { store: ProbeStore }) {
  function promoteCanaries(count = 3): number {
    return args.store.promoteCanaryIdentities(count)
  }

  async function runCanaryTest(identityId: string): Promise<CanaryTestResult> {
    const lock = args.store.getCanaryLockByIdentity(identityId)
    if (!lock?.canary_test_url) return recordFailure(identityId)
    try {
      const res = await fetch(lock.canary_test_url)
      return res.status === lock.canary_test_expected_status ? recordPass(identityId) : recordFailure(identityId)
    } catch {
      return recordFailure(identityId)
    }
  }

  function getCanaryHealth(): CanaryHealth {
    const identities = args.store.listIdentitiesByTier("canary")
    const locks = args.store.listActiveCanaryLocks()
    return {
      canary_count: identities.length,
      active_canary_count: getActiveCanaryCount(),
      last_results: locks.map((lock) => ({
        identity_id: lock.identity_id,
        result: lock.last_canary_result,
        tested_at: lock.last_canary_test_at,
      })),
    }
  }

  function getActiveCanaryCount(): number {
    return args.store.countActiveHealthyCanaries()
  }

  function recordPass(identityId: string): CanaryTestResult {
    args.store.recordCanaryResult(identityId, "pass")
    args.store.setIdentityCircuitState({ id: identityId, state: "closed", consecutiveFailures: 0, lastFailureAt: null, quarantinedUntil: null })
    return "pass"
  }

  function recordFailure(identityId: string): CanaryTestResult {
    const identity = args.store.getIdentity(identityId)
    const failures = (identity?.consecutive_failures ?? 0) + 1
    args.store.recordCanaryResult(identityId, "fail")
    args.store.setIdentityCircuitState({
      id: identityId,
      state: failures >= 3 ? "open" : identity?.circuit_state ?? "closed",
      consecutiveFailures: failures,
      lastFailureAt: Math.floor(Date.now() / 1000),
      quarantinedUntil: identity?.quarantined_until ?? null,
    })
    return "fail"
  }

  return { promoteCanaries, runCanaryTest, getCanaryHealth, getActiveCanaryCount }
}
