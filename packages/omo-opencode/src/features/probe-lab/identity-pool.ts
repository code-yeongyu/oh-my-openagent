import { createPersistentBreaker, type PersistentBreaker, type ProbeCircuitConfig } from "./circuit-breaker-store"
import type { ProbeStore } from "./sqlite-store"
import type { Identity, PoolHealth } from "./types"

const MAX_QUARANTINED_RATIO = 0.5

export type IdentityPool = ReturnType<typeof createIdentityPool>

export class PoolUnhealthyError extends Error {
  constructor(public readonly health: PoolHealth) {
    super(
      `probe pool unhealthy: ${health.quarantined}/${health.total} quarantined (ratio ${health.quarantined_ratio.toFixed(2)} >= ${MAX_QUARANTINED_RATIO})`,
    )
    this.name = "PoolUnhealthyError"
  }
}

export class NoIdentityAvailableError extends Error {
  constructor() {
    super("no active identity available")
    this.name = "NoIdentityAvailableError"
  }
}

export function createIdentityPool(args: {
  store: ProbeStore
  breakerConfig?: Partial<ProbeCircuitConfig>
}) {
  const breakers = new Map<string, PersistentBreaker>()

  function getBreaker(identity: Identity): PersistentBreaker {
    let breaker = breakers.get(identity.id)
    if (!breaker) {
      breaker = createPersistentBreaker({
        store: args.store,
        identity,
        config: args.breakerConfig,
      })
      breakers.set(identity.id, breaker)
    }
    return breaker
  }

  function acquire(preferredId?: string): { identity: Identity; breaker: PersistentBreaker } {
    args.store.promoteExpiredQuarantines()
    const health = args.store.getPoolHealth()
    if (health.total > 0 && health.quarantined_ratio >= MAX_QUARANTINED_RATIO) {
      throw new PoolUnhealthyError(health)
    }
    const identity = preferredId
      ? args.store.getIdentity(preferredId)
      : args.store.findFirstActiveIdentity()
    if (!identity) throw new NoIdentityAvailableError()
    const breaker = getBreaker(identity)
    breaker.assertOpen()
    args.store.recordIdentityUse(identity.id, Math.floor(Date.now() / 1000))
    return { identity, breaker }
  }

  function reportSuccess(identityId: string): void {
    const identity = args.store.getIdentity(identityId)
    if (!identity) return
    getBreaker(identity).recordSuccess()
  }

  function reportFailure(identityId: string): void {
    const identity = args.store.getIdentity(identityId)
    if (!identity) return
    getBreaker(identity).recordFailure()
  }

  function getHealth(): PoolHealth {
    return args.store.getPoolHealth()
  }

  return { acquire, reportSuccess, reportFailure, getHealth }
}
