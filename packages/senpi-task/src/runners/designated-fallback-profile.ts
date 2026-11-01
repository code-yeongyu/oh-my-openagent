import { splitModelDecorators } from "../senpi/explicit-pin"
import type { HostRetryFallbackProfile } from "./rpc-host/session-transport"

/**
 * The fallback policy that holds a child to exactly its designated models (#12006 / #11781): its own
 * chain keyed by its model, and an empty chain (senpi's tombstone) for every designated model's base,
 * so neither senpi's shipped default chains nor anything else can extend the walk past the last rung.
 * A one-model child gets fallback off. The overlay replaces the user's `retry.fallbackChains` wholesale,
 * so the user's chains never reach a child either.
 */
export function designatedFallbackProfile(model: string, fallbackModels: readonly string[]): HostRetryFallbackProfile {
  const tombstones = [model, ...fallbackModels]
    .map((selector) => splitModelDecorators(selector).base)
    .filter((base) => base !== model)
    .map((base) => [base, []] as const)
  return {
    modelFallback: fallbackModels.length > 0,
    fallbackChains: { ...Object.fromEntries(tombstones), [model]: [...fallbackModels] },
  }
}
