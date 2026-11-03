import { splitModelDecorators } from "../senpi/explicit-pin"
import { priorityAliasBaseId } from "./pinned-model-equivalence"
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
    fallbackChains: { ...Object.fromEntries(tombstones), ...priorityAliasBaseChain(model, fallbackModels), [model]: [...fallbackModels] },
  }
}

/**
 * senpi starts a paired `-fast` priority alias on its base model (#10536) and looks the chain up by
 * the model that is running, so a chain keyed only by the alias is never found: a usage limit on the
 * base then ends the child with no fallback at all. The alias's chain also answers under its base.
 */
function priorityAliasBaseChain(model: string, fallbackModels: readonly string[]): Record<string, string[]> {
  if (fallbackModels.length === 0) return {}
  const { base } = splitModelDecorators(model)
  const slash = base.indexOf("/")
  if (slash <= 0) return {}
  const baseId = priorityAliasBaseId(base.slice(slash + 1))
  return baseId === undefined ? {} : { [`${base.slice(0, slash)}/${baseId}`]: [...fallbackModels] }
}
