// The reflection lock's host-identity rule (./host-identity.ts) and the platform machine-id reader it
// hashes are loaded on first use through `#memory-host-identity`, so the omo-senpi entry bundle carries
// only these two forwarders: the plugin manifest maps the alias to the recall-store sidecar, and every
// other consumer resolves memory-core's own source. Both callers were already asynchronous.

import type { HostIdentityFacts, HostIdentityVerdict } from "./host-identity"

export type { HostIdentityFacts, HostIdentityVerdict, PlatformMachineIdQuery } from "./host-identity"

export async function readCurrentMachineHash(): Promise<string | null> {
  return (await import("#memory-host-identity")).readCurrentMachineHash()
}

export async function classifyHostIdentity(facts: HostIdentityFacts): Promise<HostIdentityVerdict> {
  return (await import("#memory-host-identity")).classifyHostIdentity(facts)
}
