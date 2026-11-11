import { splitModelDecorators } from "../senpi/explicit-pin"
import type { HostRetryFallbackProfile } from "./rpc-host/session-transport"

/** The designated models in try order, as a refusal names them: `a -> b -> c`. */
export function designatedChainText(model: string, fallbackModels: readonly string[]): string {
  return [model, ...fallbackModels].join(" -> ")
}

/** The designated models a profile from {@link designatedFallbackProfile} holds, in try order. */
export function designatedChainOf(profile: HostRetryFallbackProfile): string {
  const chains = Object.entries(profile.fallbackChains)
  const [model, fallbacks] = chains.find(([, chain]) => chain.length > 0)
    ?? chains.find(([key]) => !isTombstoneKey(key, chains))
    ?? chains[0] ?? ["", []]
  return designatedChainText(model, fallbacks)
}

/**
 * A key is a tombstone when another key names the same model with decorators (a thinking suffix):
 * the tombstone is the base the decorated key was derived from, so it never names the designated
 * model. A one-model child with a thinking suffix has no non-empty chain, and without this the
 * refusal would name the base instead of the designated model.
 */
function isTombstoneKey(key: string, chains: readonly (readonly [string, readonly string[]])[]): boolean {
  return chains.some(([other]) => other !== key && splitModelDecorators(other).base === key)
}

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
