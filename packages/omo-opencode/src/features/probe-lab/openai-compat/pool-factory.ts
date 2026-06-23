import { createAccountPool, type AccountPool } from "./account-pool"
import {
  loadDeepSeekProviders,
  type LoadedProvider,
  type ProviderStoreLike,
} from "./provider-factory"
import type { PoolAccount } from "./pool-types"

export type PoolFactoryArgs = {
  providerIds?: ReadonlyArray<string>
  store?: ProviderStoreLike
}

let cached: AccountPool | null = null

export function loadAccountPool(args?: PoolFactoryArgs): AccountPool {
  if (cached) return cached
  const loaded = loadDeepSeekProviders(args)
  cached = createAccountPool({ accounts: toPoolAccounts(loaded) })
  return cached
}

export function buildAccountPool(loaded: ReadonlyArray<LoadedProvider>): AccountPool {
  return createAccountPool({ accounts: toPoolAccounts(loaded) })
}

export function resetPoolCacheForTests(): void {
  if (cached) cached.shutdown()
  cached = null
}

function toPoolAccounts(loaded: ReadonlyArray<LoadedProvider>): PoolAccount[] {
  return loaded.map((l) => ({
    id: l.creds.id,
    provider: l.provider,
    baseUrl: l.baseUrl,
    creds: l.creds,
  }))
}
