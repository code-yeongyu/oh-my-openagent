import { createIdentityPool, type IdentityPool } from "./identity-pool"
import { createProbeStore, type ProbeStore } from "./sqlite-store"
import { createProviderRegistry, type ProviderRegistry } from "./providers/provider-registry"
import type { ProbeCircuitConfig } from "./circuit-breaker-store"

export type ProbeLabContext = {
  store: ProbeStore
  pool: IdentityPool
  providerRegistry: ProviderRegistry
}

let cached: ProbeLabContext | null = null

export function getProbeLabContext(args?: {
  dbPath?: string
  breakerConfig?: Partial<ProbeCircuitConfig>
}): ProbeLabContext {
  if (cached) return cached
  const store = createProbeStore(args?.dbPath)
  const pool = createIdentityPool({ store, breakerConfig: args?.breakerConfig })
  const providerRegistry = createProviderRegistry({ store })
  cached = { store, pool, providerRegistry }
  return cached
}

export function resetProbeLabContextForTests(): void {
  if (cached) {
    cached.store.close()
    cached = null
  }
}
