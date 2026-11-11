import { designatedFallbackProfile } from "./designated-fallback-profile"
import type { HostRetryFallbackProfile } from "./rpc-host/session-transport"
import type { RpcRunnerSpec } from "./types"

/**
 * The child's designated chain, in the shape senpi applies as a session-only settings overlay
 * (`open_session.retryFallback` on a host, `set_retry_fallback` in a single-session process). Every
 * child with a model gets one, a one-model child included: without it the engine would fall back
 * through the user's settings and senpi's shipped chains. Undefined only when there is no model to pin.
 */
export function childRetryFallbackProfile(spec: RpcRunnerSpec): HostRetryFallbackProfile | undefined {
  if (spec.model === undefined) return undefined
  return designatedFallbackProfile(spec.model, spec.fallbackModels ?? [])
}
