import { RATE_DEFAULTS } from "./defaults"
import type { PoolAccount, PoolAccountState, RateLimitGate } from "./pool-types"

const SUSTAINED_WINDOW_MS = 60_000

export type PolicyConfig = {
  sustainedRpmPerAccount: number
  burstInflightCapPerAccount: number
}

export const DEFAULT_POLICY: PolicyConfig = {
  sustainedRpmPerAccount: RATE_DEFAULTS.SUSTAINED_RPM_PER_ACCOUNT,
  burstInflightCapPerAccount: RATE_DEFAULTS.BURST_INFLIGHT_CAP_PER_ACCOUNT,
}

export function canAcquire(
  account: PoolAccount,
  state: PoolAccountState,
  now: number,
  policy: PolicyConfig = DEFAULT_POLICY,
): RateLimitGate {
  if (state.is_muted) {
    return { ok: false, reason: `account ${account.id} is muted` }
  }
  if (state.cooldown_until > now) {
    return {
      ok: false,
      reason: `account ${account.id} cooling down for ${state.cooldown_until - now}ms`,
    }
  }
  if (state.inflight >= policy.burstInflightCapPerAccount) {
    return {
      ok: false,
      reason: `account ${account.id} at burst cap (inflight=${state.inflight})`,
    }
  }
  const recentInWindow = countRecentInWindow(state.recent_request_ts, now)
  if (recentInWindow >= policy.sustainedRpmPerAccount) {
    return {
      ok: false,
      reason: `account ${account.id} sustained-rpm cap (${recentInWindow}/${policy.sustainedRpmPerAccount})`,
    }
  }
  return { ok: true }
}

export function countRecentInWindow(
  timestamps: ReadonlyArray<number>,
  now: number,
): number {
  const threshold = now - SUSTAINED_WINDOW_MS
  let count = 0
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i]! >= threshold) count++
    else break
  }
  return count
}

export function pruneTimestamps(
  timestamps: number[],
  now: number,
): number[] {
  const threshold = now - SUSTAINED_WINDOW_MS
  let firstKeep = 0
  while (firstKeep < timestamps.length && timestamps[firstKeep]! < threshold) {
    firstKeep++
  }
  return firstKeep === 0 ? timestamps : timestamps.slice(firstKeep)
}
