import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { AgentDefinition, PlanResolutionError } from "@oh-my-opencode/senpi-task"

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

// A pin can also live in the models list the schema accepts, and that list is a different key: naming
// `.model` would send the reader to a key they never wrote.
function pinFixKey(target: ChainFailureTarget, pinKey: "model" | "models"): string {
  if (pinKey === "model") return chainFixKey(target)
  return "category" in target ? `categories.${target.category}.models` : `agents.${target.agent}.models`
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
  const models = chain.length === 0 ? "none" : chainEntriesText(chain)
  const reason = missingProviders.length === 0
    ? "its chain's providers are connected but none of them lists these model ids"
    : `its chain needs providers this machine has not connected (${missingProviders.join(", ")})`
  const fix = missingProviders.length === 0
    ? `set ${chainFixKey(target)} in Settings to a model you already run`
    : `connect one of those providers, or set ${chainFixKey(target)} in Settings to a model you already run`
  return `${targetKind(target)} "${targetName(target)}" has no usable model: ${reason}. Chain, in order: ${models}.${unlistedOptInText(unlistedModel, target)} Fix: ${fix}. No child was spawned.`
}

/**
 * The refusal for a target the user pinned to a model the live registry does not serve. The pin is
 * a choice, so it is never replaced; the message names it and the two ways out, so the parent stops
 * retrying the same broken binding.
 */
export function pinnedModelUnavailableText(
  target: ChainFailureTarget,
  pinnedModel: string,
  pinKey: "model" | "models" = "model",
): string {
  return `${targetKind(target)} "${targetName(target)}" is pinned to "${pinnedModel}", which this machine's model registry does not serve: that provider is not connected, or it does not list that model id. Fix: connect the provider, or re-pick ${pinFixKey(target, pinKey)} in Settings. No child was spawned.`
}

export type AgentUnavailable = {
  readonly agent?: string
  readonly attemptedModel: string | undefined
  readonly attempted_chain?: readonly DelegateFallbackEntry[]
  readonly missing_providers?: readonly string[]
}

// A category refusal: a dead chain names every model and the fix, a pin the registry cannot serve
// names the pin. Any other model_unavailable keeps the resolver's own text.
export function categoryModelFailureText(
  error: PlanResolutionError,
  omoConfig: OmoConfig,
  canonicalCategory?: string,
): string | undefined {
  // The resolver canonicalizes a retired alias; the Settings key and the pin live under the
  // canonical name, so the refusal must name that one.
  const category = canonicalCategory ?? error.category
  if (category === undefined) return undefined
  if (error.attempted_chain !== undefined) {
    return chainUnavailableText({ category }, error.attempted_chain, error.missing_providers ?? [], error.unlisted_provider_model)
  }
  // A pin can be written either way the schema allows: a scalar model or a models list.
  const pin = firstConfiguredPin(omoConfig.categories?.[category])
  return pin === undefined ? undefined : pinnedModelUnavailableText({ category }, pin.model, pin.key)
}

type ModelPinConfig = {
  readonly model?: string | undefined
  readonly models?: readonly (string | { readonly model: string })[] | undefined
}

// Which field held the pin matters to the reader: the fix names that field, not one they never wrote.
function firstConfiguredPin(config: ModelPinConfig | undefined): { readonly model: string; readonly key: "model" | "models" } | undefined {
  if (config?.model !== undefined) return { model: config.model, key: "model" }
  const entry = config?.models?.[0]
  if (entry === undefined) return undefined
  return { model: typeof entry === "string" ? entry : entry.model, key: "models" }
}

export function agentModelFailureText(
  agentName: string,
  resolution: AgentUnavailable,
  agents: Readonly<Record<string, AgentDefinition>>,
): string {
  // The resolver canonicalizes a retired alias, so the pin and the Settings key live under that
  // name; keying the lookup on the requested alias missed the pin entirely.
  const agent = resolution.agent ?? agentName
  const definition = Object.hasOwn(agents, agent) ? agents[agent] : undefined
  // A pin is the cause of the failure, so it wins over the chain that the pin replaced: refusing
  // with the chain text told a pinned agent's caller to set the key it had already set.
  const pinned = firstConfiguredPin(definition)
  if (pinned !== undefined) return pinnedModelUnavailableText({ agent }, pinned.model, pinned.key)
  if (resolution.attempted_chain !== undefined) {
    return chainUnavailableText({ agent }, resolution.attempted_chain, resolution.missing_providers ?? [], undefined)
  }
  return `No available model for agent "${agent}" (attempted ${resolution.attemptedModel ?? "none"}).`
}
