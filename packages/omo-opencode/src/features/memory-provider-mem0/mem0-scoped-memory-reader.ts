import { Mem0L2AdapterError } from "./errors"
import { retryMem0NotFound } from "./mem0-not-found-retry"
import {
  assertMem0MemoryInScope,
  type Mem0ScopeConfig,
} from "./mem0-scope-guard"
import type { Mem0RateLimiter } from "./rate-limiter"
import type { Mem0Client, Mem0Memory } from "./types"

export async function readScopedMem0Memory(params: {
  providerExternalId: string
  opName: string
  getClient: () => Promise<Mem0Client>
  rateLimiter: Pick<Mem0RateLimiter, "executeWithRetry">
  scope: Mem0ScopeConfig
}): Promise<Mem0Memory> {
  const client = await params.getClient()
  const result = await retryMem0NotFound(
    params.rateLimiter,
    async () => client.get(params.providerExternalId),
    params.opName,
  )

  if (!result) {
    throw new Mem0L2AdapterError(`Mem0 memory "${params.providerExternalId}" was not found`, 404)
  }

  assertMem0MemoryInScope(result, params.scope, params.providerExternalId)
  return result
}
