import type { ProbeProvider, ProviderCredentials } from "../providers/provider-types"

export type PoolAccount = {
  id: string
  provider: ProbeProvider
  baseUrl: string
  creds: ProviderCredentials
}

export type PoolAccountState = {
  inflight: number
  last_used_at: number
  cooldown_until: number
  is_muted: boolean
  recent_request_ts: number[]
}

export type AcquireResult = {
  account: PoolAccount
  release: () => void
}

export type AcquireRejection = {
  ok: false
  reason: string
}

export type RateLimitGate =
  | { ok: true }
  | AcquireRejection
