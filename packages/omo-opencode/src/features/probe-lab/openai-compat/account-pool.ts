import { log } from "../../../shared/logger"
import { RATE_DEFAULTS } from "./defaults"
import type {
  AcquireResult,
  PoolAccount,
  PoolAccountState,
} from "./pool-types"
import {
  canAcquire,
  DEFAULT_POLICY,
  pruneTimestamps,
  type PolicyConfig,
} from "./rate-limit-policy"

export type Waiter = {
  resolve: (r: AcquireResult) => void
  reject: (e: Error) => void
  enqueuedAt: number
  timeoutId: ReturnType<typeof setTimeout>
}

export type AccountPool = {
  size: () => number
  list: () => ReadonlyArray<PoolAccount>
  acquire: (timeoutMs?: number) => Promise<AcquireResult>
  markMuted: (accountId: string) => void
  markUnmuted: (accountId: string) => void
  triggerCooldown: (accountId: string, durationMs?: number) => void
  getState: (accountId: string) => PoolAccountState | null
  shutdown: () => void
}

export type AccountPoolArgs = {
  accounts: ReadonlyArray<PoolAccount>
  policy?: PolicyConfig
  cooldownMs?: number
  now?: () => number
}

export function createAccountPool(args: AccountPoolArgs): AccountPool {
  if (args.accounts.length === 0) {
    throw new Error("createAccountPool: at least one account required")
  }
  const policy = args.policy ?? DEFAULT_POLICY
  const cooldownMs = args.cooldownMs ?? RATE_DEFAULTS.COOLDOWN_AFTER_BURST_MS
  const now = args.now ?? (() => Date.now())

  const accounts = args.accounts
  const states = new Map<string, PoolAccountState>()
  for (const a of accounts) {
    states.set(a.id, {
      inflight: 0,
      last_used_at: 0,
      cooldown_until: 0,
      is_muted: false,
      recent_request_ts: [],
    })
  }

  let cursor = 0
  const waiters: Waiter[] = []
  let shuttingDown = false

  function pickAvailable(): PoolAccount | null {
    const t = now()
    for (let i = 0; i < accounts.length; i++) {
      const idx = (cursor + i) % accounts.length
      const account = accounts[idx]!
      const state = states.get(account.id)!
      const gate = canAcquire(account, state, t, policy)
      if (gate.ok) {
        cursor = (idx + 1) % accounts.length
        return account
      }
    }
    return null
  }

  function release(accountId: string): void {
    const state = states.get(accountId)
    if (!state) return
    if (state.inflight > 0) state.inflight--
    notifyWaiters()
  }

  function buildAcquire(account: PoolAccount): AcquireResult {
    const state = states.get(account.id)!
    state.inflight++
    state.last_used_at = now()
    state.recent_request_ts = pruneTimestamps(state.recent_request_ts, now())
    state.recent_request_ts.push(now())
    let released = false
    return {
      account,
      release: () => {
        if (released) return
        released = true
        release(account.id)
      },
    }
  }

  function notifyWaiters(): void {
    while (waiters.length > 0) {
      const account = pickAvailable()
      if (!account) break
      const w = waiters.shift()!
      clearTimeout(w.timeoutId)
      w.resolve(buildAcquire(account))
    }
  }

  return {
    size: () => accounts.length,
    list: () => accounts,
    async acquire(timeoutMs = 30_000): Promise<AcquireResult> {
      if (shuttingDown) {
        return Promise.reject(new Error("account-pool: shutting down"))
      }
      const account = pickAvailable()
      if (account) return buildAcquire(account)
      return new Promise<AcquireResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timeoutId === timeoutId)
          if (idx >= 0) waiters.splice(idx, 1)
          reject(new Error(`account-pool: acquire timeout after ${timeoutMs}ms`))
        }, timeoutMs)
        waiters.push({ resolve, reject, enqueuedAt: now(), timeoutId })
      })
    },
    markMuted(accountId) {
      const s = states.get(accountId)
      if (!s) return
      if (!s.is_muted) {
        log(`openai-compat-pool: account ${accountId} marked muted`)
      }
      s.is_muted = true
    },
    markUnmuted(accountId) {
      const s = states.get(accountId)
      if (!s) return
      if (s.is_muted) {
        log(`openai-compat-pool: account ${accountId} cleared mute`)
      }
      s.is_muted = false
      notifyWaiters()
    },
    triggerCooldown(accountId, durationMs = cooldownMs) {
      const s = states.get(accountId)
      if (!s) return
      s.cooldown_until = Math.max(s.cooldown_until, now() + durationMs)
    },
    getState(accountId) {
      return states.get(accountId) ?? null
    },
    shutdown() {
      shuttingDown = true
      for (const w of waiters.splice(0)) {
        clearTimeout(w.timeoutId)
        w.reject(new Error("account-pool: shutting down"))
      }
    },
  }
}
