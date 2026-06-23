import type {
  AccountFleet,
  ProviderId,
} from "../../account-fleet"
import { createDeepSeekWebProvider } from "../providers/deepseek-web-provider"
import type { ProviderCredentials } from "../providers/provider-types"
import type { AccountPool } from "./account-pool"
import type { AcquireResult, PoolAccount } from "./pool-types"

export type ProviderIdMapper = (probeLabProviderId: string) => ProviderId | null

export type AccountFleetBridgeDeps = {
  fleet: AccountFleet
  probeLabFallback: AccountPool
  providerIdToAccountFleetId: ProviderIdMapper
  acquireProviderIdHint?: string
}

export type HybridPoolSnapshot = {
  fleet_acquired_count: number
  fallback_acquired_count: number
  last_source: "account-fleet" | "probe-lab" | null
}

export type HybridPool = AccountPool & {
  snapshot(): HybridPoolSnapshot
}

type AcquireSource = "account-fleet" | "probe-lab"

function buildAdaptedCreds(
  fleet: AccountFleet,
  account_id: string,
  baseUrl: string,
  capabilitiesJson: string,
  decryptedAuth: string,
  proxyUrl: string | null,
  displayName: string,
): ProviderCredentials {
  const default_headers = proxyUrl
    ? JSON.stringify({ __proxy_url__: proxyUrl })
    : null
  void fleet
  return {
    id: account_id,
    name: displayName,
    provider_type: "deepseek_web",
    base_url: baseUrl,
    auth_type: "cookie_session",
    auth_config: decryptedAuth,
    default_headers,
    rate_limit_rps: null,
    rate_limit_rpm: null,
    rate_limit_tpm: null,
    cooldown_on_429_s: 90,
    supported_models: capabilitiesJson,
    health_check_url: null,
    health_check_interval_s: 300,
    status: "active",
    created_at: 0,
    updated_at: 0,
  }
}

function buildPoolAccountFromFleet(
  fleet: AccountFleet,
  fleetAccount: ReturnType<AccountFleet["accounts"]["getById"]> & object,
  binding: ReturnType<AccountFleet["bindings"]["getById"]> | null,
): PoolAccount | null {
  const provider = fleet.providers.getById(fleetAccount.provider_id)
  if (!provider) return null
  const decryptedAuth = fleet.decryptAuth(fleetAccount)
  const proxyUrl = binding ? fleet.decrypt(binding.proxy_url_encrypted) : null
  const creds = buildAdaptedCreds(
    fleet,
    fleetAccount.id,
    provider.base_url,
    fleetAccount.capabilities,
    decryptedAuth,
    proxyUrl,
    fleetAccount.display_name,
  )
  return {
    id: fleetAccount.id,
    provider: createDeepSeekWebProvider(creds),
    baseUrl: provider.base_url,
    creds,
  }
}

export function createAccountFleetBridge(deps: AccountFleetBridgeDeps): HybridPool {
  const sourceByAccountId = new Map<string, AcquireSource>()
  let fleetAcquired = 0
  let fallbackAcquired = 0
  let lastSource: AcquireSource | null = null

  function tryAcquireFromFleet(): AcquireResult | null {
    const probeLabId = deps.acquireProviderIdHint
    const fleetProviderId = probeLabId
      ? deps.providerIdToAccountFleetId(probeLabId)
      : null
    const result = deps.fleet.pool.acquire({
      provider_id: fleetProviderId ?? undefined,
    })
    if (result.kind !== "acquired") return null
    const fleetAccount = deps.fleet.accounts.getById(result.account.id)
    if (!fleetAccount) {
      deps.fleet.pool.release(result.lease.id)
      return null
    }
    const poolAccount = buildPoolAccountFromFleet(
      deps.fleet,
      fleetAccount,
      result.binding ?? null,
    )
    if (!poolAccount) {
      deps.fleet.pool.release(result.lease.id)
      return null
    }
    sourceByAccountId.set(poolAccount.id, "account-fleet")
    fleetAcquired += 1
    lastSource = "account-fleet"
    let released = false
    return {
      account: poolAccount,
      release: () => {
        if (released) return
        released = true
        deps.fleet.pool.release(result.lease.id)
      },
    }
  }

  return {
    size: () => deps.fleet.snapshot().pool.observer.active_leases.length + deps.probeLabFallback.size(),
    list: () => deps.probeLabFallback.list(),
    async acquire(timeoutMs?: number): Promise<AcquireResult> {
      const fleetResult = tryAcquireFromFleet()
      if (fleetResult) return fleetResult
      const fallback = await deps.probeLabFallback.acquire(timeoutMs)
      sourceByAccountId.set(fallback.account.id, "probe-lab")
      fallbackAcquired += 1
      lastSource = "probe-lab"
      return fallback
    },
    markMuted: (accountId) => {
      if (sourceByAccountId.get(accountId) === "probe-lab") {
        deps.probeLabFallback.markMuted(accountId)
      }
    },
    markUnmuted: (accountId) => {
      if (sourceByAccountId.get(accountId) === "probe-lab") {
        deps.probeLabFallback.markUnmuted(accountId)
      }
    },
    triggerCooldown: (accountId, durationMs) => {
      if (sourceByAccountId.get(accountId) === "probe-lab") {
        deps.probeLabFallback.triggerCooldown(accountId, durationMs)
      }
    },
    getState: (accountId) => {
      if (sourceByAccountId.get(accountId) === "probe-lab") {
        return deps.probeLabFallback.getState(accountId)
      }
      return null
    },
    shutdown: () => {
      deps.probeLabFallback.shutdown()
      try {
        deps.fleet.stop()
      } catch {
        return
      }
    },
    snapshot: () => ({
      fleet_acquired_count: fleetAcquired,
      fallback_acquired_count: fallbackAcquired,
      last_source: lastSource,
    }),
  }
}
