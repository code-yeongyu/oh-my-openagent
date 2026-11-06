import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

export type ChainFailureTarget = { readonly category: string } | { readonly agent: string }

function targetKind(target: ChainFailureTarget): string {
  return "category" in target ? "Category" : "Agent"
}

function targetName(target: ChainFailureTarget): string {
  return "category" in target ? target.category : target.agent
}

// The Settings editor writes exactly these keys (categories.<name>.model / agents.<name>.model), so
// the refusal names the key the reader can change instead of a generic "configure omo.json".
function chainFixKey(target: ChainFailureTarget): string {
  return "category" in target ? `categories.${target.category}.model` : `agents.${target.agent}.model`
}

// One entry per chain rung: the model and the providers that can serve it. The reader acts on the
// first entry they recognize, which a single "attempted <id>" never allowed.
function chainEntriesText(chain: readonly DelegateFallbackEntry[]): string {
  return chain.map((rung) => `${rung.model} (${rung.providers.join(" or ")})`).join(", ")
}

function unlistedOptInText(unlistedModel: string | undefined, target: ChainFailureTarget): string {
  if (unlistedModel === undefined) return ""
  const slash = unlistedModel.indexOf("/")
  if (slash <= 0) return ""
  const gateway = unlistedModel.slice(0, slash)
  const model = unlistedModel.slice(slash + 1)
  return ` Only ${gateway} serves ${model}, and omo never bills a builtin ${targetKind(target).toLowerCase()} to an unlisted provider; set ${chainFixKey(target)} = "${unlistedModel}" to opt in.`
}

/**
 * The spawn-time refusal for a target whose whole chain needs providers this machine has not
 * connected. It names EVERY model in the chain, the providers each one needs, and both fixes:
 * connect a provider, or point the target at a model the machine already runs. Nothing is
 * substituted and no child is spawned (Q's standing model rule: a chain ends in a typed failure
 * that names each model).
 */
export function chainUnavailableText(
  target: ChainFailureTarget,
  chain: readonly DelegateFallbackEntry[],
  missingProviders: readonly string[],
  unlistedModel: string | undefined,
): string {
  const providers = missingProviders.length === 0 ? "none" : missingProviders.join(", ")
  const models = chain.length === 0 ? "none" : chainEntriesText(chain)
  return `${targetKind(target)} "${targetName(target)}" has no usable model: its chain needs providers this machine has not connected (${providers}). Chain, in order: ${models}.${unlistedOptInText(unlistedModel, target)} Fix: connect one of those providers, or set ${chainFixKey(target)} in Settings to a model you already run. No child was spawned.`
}

/**
 * The refusal for a target the user pinned to a model the live registry does not serve. The pin is
 * a choice, so it is never replaced; the message names it and the two ways out, so the parent stops
 * retrying the same broken binding.
 */
export function pinnedModelUnavailableText(target: ChainFailureTarget, pinnedModel: string): string {
  return `${targetKind(target)} "${targetName(target)}" is pinned to "${pinnedModel}", which this machine's model registry does not serve: that provider is not connected, or it does not list that model id. Fix: connect the provider, or re-pick ${chainFixKey(target)} in Settings. No child was spawned.`
}
