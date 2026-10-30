import type { HostRetryFallbackProfile } from "./rpc-host/session-transport"
import type { RpcRunnerSpec } from "./types"

/**
 * The child's own fallback chain after its model, in the shape senpi applies as a session-only settings
 * overlay (`open_session.retryFallback` on a host, `set_retry_fallback` in a single-session process).
 * Undefined when the child has no chain: it then keeps the fallback the user's settings give it.
 */
export function childRetryFallbackProfile(spec: RpcRunnerSpec): HostRetryFallbackProfile | undefined {
  const chain = spec.fallbackModels ?? []
  if (spec.model === undefined || chain.length === 0) return undefined
  return { modelFallback: true, fallbackChains: { [spec.model]: [...chain] } }
}
