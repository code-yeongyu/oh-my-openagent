// One shared host-identity decision (#1793303560): "is this reflection reservation mine". The lock
// records a hostname, which is not globally unique, so two of a user's machines with the same name
// would each treat the other's live reservation as its own dead one and reclaim it. The platform
// machine id disambiguates: when both sides carry an id hash, equal hashes mean the same machine and
// unequal hashes mean a foreign machine regardless of what the two hostnames say. Exact hostname
// equality stays the fallback for legacy records (no hash) and for a machine whose id cannot be read.
//
// The raw platform id never leaves this module: the lock, its quarantine evidence and every
// comparison only see a domain-separated sha256 of it (as `deviceFingerprint` does for sync).
//
// The id is read lazily (never on the hot path) and only a successful lookup is memoized, so a
// timeout or an unreadable id is re-attempted by the next call instead of being remembered as null.

import { createHash } from "node:crypto"

import { platformMachineId } from "../sync/item/machine-id"

export type PlatformMachineIdQuery = () => Promise<string | null>

/** The only form of the platform machine id the reflection lock stores or compares. */
export function reflectionHostHash(machineId: string): string {
  return createHash("sha256").update(`omo-reflection-host:${machineId}`).digest("hex")
}

/**
 * Memoizes only a successful machine-id lookup. A null or failed lookup is never cached, so a later
 * call re-attempts it (a lookup that times out once and then succeeds is re-attempted, and the id
 * rule then applies). Concurrent callers share the in-flight promise; only its success is kept.
 */
export function createMachineIdReader(query: PlatformMachineIdQuery): () => Promise<string | null> {
  let cached: Promise<string | null> | null = null
  return () => {
    if (cached === null) {
      cached = query().then(
        (id) => {
          if (id === null) cached = null
          return id
        },
        () => {
          cached = null
          return null
        },
      )
    }
    return cached
  }
}

/** A memoized reader that hashes the platform id as soon as it is read, so callers never see it raw. */
export function createMachineHashReader(query: PlatformMachineIdQuery): () => Promise<string | null> {
  return createMachineIdReader(async () => {
    const id = await query()
    return id === null ? null : reflectionHostHash(id)
  })
}

/** The process-wide reader of this machine's reflection host hash. */
export const readCurrentMachineHash: () => Promise<string | null> = createMachineHashReader(platformMachineId)

export interface HostIdentityFacts {
  readonly recordedHostname: string
  readonly recordedMachineHash: string | undefined
  readonly currentHostname: string
  readonly currentMachineHash: () => Promise<string | null>
}

export type HostIdentityVerdict =
  | { readonly state: "local" }
  | { readonly state: "foreign"; readonly recordedHostname: string; readonly viaMachineId: boolean }

/**
 * The one shared rule. When the record carries a machine hash and the current lookup resolves, the
 * hashes decide; otherwise exact hostname equality decides. The machine id is looked up only when the
 * record actually carries a hash, so legacy records and an absent lock never touch the platform query.
 */
export async function classifyHostIdentity(facts: HostIdentityFacts): Promise<HostIdentityVerdict> {
  if (facts.recordedMachineHash === undefined) {
    return hostnameVerdict(facts.recordedHostname, facts.currentHostname)
  }
  const currentMachineHash = await facts.currentMachineHash()
  if (currentMachineHash === null) {
    return hostnameVerdict(facts.recordedHostname, facts.currentHostname)
  }
  return facts.recordedMachineHash === currentMachineHash
    ? { state: "local" }
    : { state: "foreign", recordedHostname: facts.recordedHostname, viaMachineId: true }
}

function hostnameVerdict(recordedHostname: string, currentHostname: string): HostIdentityVerdict {
  return recordedHostname === currentHostname
    ? { state: "local" }
    : { state: "foreign", recordedHostname, viaMachineId: false }
}
