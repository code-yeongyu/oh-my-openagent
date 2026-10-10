// Which identity a (re)bind uses when the session already carries a binding entry.
//
// The recorded binding is the only evidence of what the session WAS, and config resolution is the
// suspect: one shared host serves sessions from many workspaces, so a host ensured from another
// directory resolves a foreign identity for every session it reattaches (#8556). The record
// therefore wins, and the divergence is an info-level rebind rather than a user-facing error.
// The error survives for the two cases the record cannot answer: an explicitly configured
// `memory.agent` that names a different identity (a user-initiated change), and a record whose
// memory repository cannot be reproduced under the current memory root.
import { buildIdentityPaths, isAutoAgentValue, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryBinding, type MemorySessionBinding } from "./binding"

export interface BoundIdentity {
  readonly id: string
  readonly paths: MemoryIdentityPaths
}

export type IdentityAdoption =
  | { readonly kind: "resolved"; readonly identity: BoundIdentity }
  | { readonly kind: "rebound"; readonly identity: BoundIdentity }
  | { readonly kind: "conflict" }

export function adoptSessionIdentity(input: {
  readonly recorded: MemorySessionBinding | undefined
  readonly resolved: BoundIdentity
  readonly memoryRoot: string
  readonly configAgentValue: string | null | undefined
  readonly verifyRepository: boolean
}): IdentityAdoption {
  const { recorded, resolved } = input
  if (recorded === undefined) return { kind: "resolved", identity: resolved }
  if (recorded.identity === resolved.id) {
    if (input.verifyRepository && !repositoryMatches(recorded, resolved)) return { kind: "conflict" }
    return { kind: "resolved", identity: resolved }
  }
  if (!isAutoAgentValue(input.configAgentValue)) return { kind: "conflict" }
  const adopted: BoundIdentity = { id: recorded.identity, paths: buildIdentityPaths(input.memoryRoot, recorded.identity) }
  if (!repositoryMatches(recorded, adopted)) return { kind: "conflict" }
  return { kind: "rebound", identity: adopted }
}

function repositoryMatches(recorded: MemorySessionBinding, identity: BoundIdentity): boolean {
  const rebuilt = createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: recorded.boundAt })
  return rebuilt.repoPathHash === recorded.repoPathHash
}
